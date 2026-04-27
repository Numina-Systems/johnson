// pattern: Imperative Shell — Discord bot interface for the agent

import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  ChannelType,
  type Message as DiscordMessage,
  type TextChannel,
  type ThreadChannel,
} from 'discord.js';
import type { DiscordConfig } from '../config/types.ts';
import type { Agent, ChatImage } from '../agent/types.ts';
import type { Store } from '../store/store.ts';
import { loadConversation } from '../agent/messages.ts';
import { formatStats } from '../agent/format-stats.ts';

type AgentFactory = () => Agent;

const MAX_DISCORD_LENGTH = 2000;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

// Use stderr for logging so output isn't swallowed by the Ink TUI
import { log as _log } from '../util/log.ts';
const log = (...args: Array<unknown>) => _log(`[discord] ${args.join(' ')}`);

/**
 * Fetch an image URL and convert it to a base64 data URI.
 * Returns null if the image exceeds the size limit or fetch fails.
 */
async function fetchImageAsDataUri(url: string, contentType: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;

    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_IMAGE_SIZE) {
      log(`Skipping image (${(buf.byteLength / 1024 / 1024).toFixed(1)}MB exceeds 10MB limit)`);
      return null;
    }

    const base64 = Buffer.from(buf).toString('base64');
    return `data:${contentType};base64,${base64}`;
  } catch (err) {
    log(`Failed to fetch image: ${err}`);
    return null;
  }
}

/**
 * Extract image attachments from a discord.js Message and convert to base64 data URIs.
 */
async function extractDiscordImages(msg: DiscordMessage): Promise<ChatImage[]> {
  const images: ChatImage[] = [];
  for (const [, attachment] of msg.attachments) {
    if (!attachment.contentType?.startsWith('image/')) continue;
    const dataUri = await fetchImageAsDataUri(attachment.url, attachment.contentType);
    if (dataUri) {
      images.push({ url: dataUri, filename: attachment.name ?? undefined });
    }
  }
  return images;
}

/**
 * Split a long message into chunks that fit Discord's 2000 char limit.
 * Tries to split on newlines, falls back to hard cut.
 */
function splitMessage(text: string): Array<string> {
  if (text.length <= MAX_DISCORD_LENGTH) return [text];

  const chunks: Array<string> = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_DISCORD_LENGTH) {
      chunks.push(remaining);
      break;
    }

    let splitAt = remaining.lastIndexOf('\n', MAX_DISCORD_LENGTH);
    if (splitAt < MAX_DISCORD_LENGTH * 0.5) {
      splitAt = remaining.lastIndexOf(' ', MAX_DISCORD_LENGTH);
    }
    if (splitAt < MAX_DISCORD_LENGTH * 0.5) {
      splitAt = MAX_DISCORD_LENGTH;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}

export function createDiscordBot(
  config: Readonly<DiscordConfig>,
  agent: Agent,
  store: Store,
): { start(): Promise<void>; stop(): void; sendToChannel(channelId: string, message: string): Promise<void> } {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.Message, Partials.User],
  });

  // Track which threads we've created (thread ID → parent channel ID)
  const managedThreads = new Set<string>();

  const prefix = config.prefix ?? '!';
  // Empty array = allow all (null means no filtering)
  const allowedSet = config.allowedChannels && config.allowedChannels.length > 0
    ? new Set(config.allowedChannels)
    : null;

  const allowedUsers = config.allowedUsers && config.allowedUsers.length > 0
    ? new Set(config.allowedUsers)
    : null;

  /**
   * Process an incoming message. Works for both discord.js Message objects
   * and manually constructed messages from raw events.
   */
  async function processMessage(
    content: string,
    channelId: string,
    authorId: string,
    reply: (text: string) => Promise<void>,
    images?: ChatImage[],
  ): Promise<void> {
    // Ignore messages from self
    if (client.user && authorId === client.user.id) return;

    // User allowlist — only respond to allowed users (still reads all messages)
    if (allowedUsers && !allowedUsers.has(authorId)) return;

    if (!content.trim()) return;

    let processed = content;

    // Strip prefix if present
    if (processed.startsWith(prefix)) {
      processed = processed.slice(prefix.length).trim();
    }

    // Strip mention if present
    if (client.user) {
      processed = processed.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
    }

    if (!processed) return;

    // Handle reset command
    if (processed === 'reset') {
      store.clearMessages(channelId);
      await reply('🔄 Conversation reset.');
      return;
    }

    // Ensure session exists and load conversation history
    store.ensureSession(channelId);
    const history = loadConversation(store, channelId);

    // Save user message to DB (before calling agent — for persistence)
    store.appendMessage(channelId, 'user', content);

    // Send typing indicator
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel && 'sendTyping' in channel) {
        await channel.sendTyping();
      }
    } catch { /* ignore typing errors */ }

    let typingInterval: ReturnType<typeof setInterval> | undefined;
    try {
      typingInterval = setInterval(async () => {
        try {
          const ch = client.channels.cache.get(channelId);
          if (ch && 'sendTyping' in ch) await ch.sendTyping();
        } catch { /* ignore */ }
      }, 8_000);

      const result = await agent.chat(processed, {
        context: { channelId },
        images,
        conversationOverride: history,
        sessionId: channelId,
      });
      const response = result.text;

      // Save assistant response to DB
      store.appendMessage(channelId, 'assistant', response);

      const statsLine = `-# ${formatStats(result.stats)}`;

      const chunks = splitMessage(response || '(no response)');
      for (const chunk of chunks) {
        await reply(chunk);
      }
      // Send stats as a final subtle line
      await reply(statsLine);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      await reply(`❌ Error: ${errMsg.slice(0, 500)}`).catch(() => {});
    } finally {
      if (typingInterval) clearInterval(typingInterval);
    }
  }

  /**
   * Handle guild messages — creates a thread for each new conversation.
   * If the message is already in a managed thread, continues in that thread.
   */
  async function handleMessage(msg: DiscordMessage): Promise<void> {
    if (msg.partial) {
      try { await msg.fetch(); } catch { return; }
    }
    if (msg.channel.partial) {
      try { await msg.channel.fetch(); } catch { return; }
    }

    if (msg.author.bot) return;

    const isDM = msg.channel.type === ChannelType.DM;

    // Skip DMs here — handled by raw event instead
    if (isDM) return;

    // Check if this is a message in a managed thread — continue the conversation
    const isThread = msg.channel.type === ChannelType.PublicThread || msg.channel.type === ChannelType.PrivateThread;
    if (isThread && managedThreads.has(msg.channelId)) {
      const thread = msg.channel as ThreadChannel;
      log(`Thread message from ${msg.author.tag} in "${thread.name}": "${msg.content.slice(0, 50)}"`);

      // Extract images from Discord attachments
      const images = await extractDiscordImages(msg);

      await processMessage(
        msg.content,
        msg.channelId,
        msg.author.id,
        async (text) => { await thread.send(text); },
        images,
      );
      return;
    }

    // For non-thread messages, require mention or prefix
    const isMention = msg.mentions.has(client.user!);
    const hasPrefix = msg.content.startsWith(prefix);

    if (!isMention && !hasPrefix) return;
    if (allowedSet && !allowedSet.has(msg.channelId)) return;

    const channel = msg.channel;
    if (!('send' in channel)) return;

    log(`Guild message from ${msg.author.tag}: "${msg.content.slice(0, 50)}"`);
    const guildImages = await extractDiscordImages(msg);

    // Create a thread for this conversation
    let thread: ThreadChannel;
    try {
      // Generate a short thread name from the message
      // Strip Discord mentions (<@123>, <@!123>, <#123>, <@&123>) first, then non-word chars
      const threadName = msg.content
        .replace(/<@[!&]?\d+>/g, '')       // user/role mentions
        .replace(/<#\d+>/g, '')            // channel mentions
        .replace(/[^\w\s-]/g, '')
        .trim()
        .slice(0, 80) || 'conversation';
      thread = await (channel as TextChannel).threads.create({
        name: threadName,
        startMessage: msg,
        autoArchiveDuration: 1440, // 24 hours
      });
      managedThreads.add(thread.id);
      log(`Created thread "${thread.name}" (${thread.id})`);
    } catch (err) {
      // Fall back to replying in-channel if thread creation fails
      log(`Failed to create thread, replying in-channel: ${err}`);
      await processMessage(
        msg.content,
        msg.channelId,
        msg.author.id,
        async (text) => {
          if ('send' in channel) await channel.send(text);
        },
        guildImages,
      );
      return;
    }

    await processMessage(
      msg.content,
      thread.id,
      msg.author.id,
      async (text) => { await thread.send(text); },
      guildImages,
    );
  }

  // ── Event listeners ───────────────────────────────────────────────

  client.on(Events.ClientReady, () => {
    log(`Ready! Logged in as ${client.user?.tag}. Guilds: ${client.guilds.cache.size}`);
  });

  client.on('error', (err) => {
    log(`Client error: ${err.message}`);
  });

  // Handle guild messages via normal event
  client.on(Events.MessageCreate, (msg) => {
    handleMessage(msg).catch((err) => {
      log('Unhandled error in guild message handler:', err);
    });
  });

  // Handle DMs via raw gateway event — bypasses discord.js's broken DM pipeline
  client.on('raw' as any, async (event: any) => {
    try {
      if (event?.t !== 'MESSAGE_CREATE') return;

      const data = event.d;
      if (!data) return;

      // Only handle DMs (no guild_id)
      if (data.guild_id) return;

      // Ignore bots
      if (data.author?.bot) return;

      const content = data.content ?? '';
      const channelId = data.channel_id as string;
      const authorId = data.author?.id as string;
      const authorName = data.author?.username ?? 'unknown';

      log(`DM from ${authorName}: "${content.slice(0, 50)}"`);

      // Extract images from raw gateway attachments
      const rawAttachments = data.attachments ?? [];
      const rawImageAttachments = rawAttachments.filter((a: any) =>
        a.content_type?.startsWith('image/'));
      const dmImages: ChatImage[] = [];
      for (const att of rawImageAttachments) {
        const dataUri = await fetchImageAsDataUri(att.url, att.content_type);
        if (dataUri) {
          dmImages.push({ url: dataUri, filename: att.filename });
        }
      }

      // Build a reply function using the REST API
      const reply = async (text: string): Promise<void> => {
        const chunks = splitMessage(text);
        for (const chunk of chunks) {
          await client.rest.post(`/channels/${channelId}/messages`, {
            body: { content: chunk },
          });
        }
      };

      await processMessage(content, channelId, authorId, reply, dmImages);
    } catch (err) {
      log('Error handling raw DM:', err);
    }
  });

  return {
    async start(): Promise<void> {
      await client.login(config.token);
      log(`Logged in as ${client.user?.tag ?? 'unknown'}`);
      log(`Prefix: "${prefix}", DMs: enabled, channels: ${allowedSet ? [...allowedSet].join(', ') : 'all'}, users: ${allowedUsers ? [...allowedUsers].join(', ') : 'all'}`);
    },

    stop(): void {
      client.destroy();
      log('Bot disconnected.');
    },

    async sendToChannel(channelId: string, message: string): Promise<void> {
      const channel = await client.channels.fetch(channelId);
      if (channel && 'send' in channel) {
        const chunks = splitMessage(message);
        for (const chunk of chunks) {
          await channel.send(chunk);
        }
      } else {
        throw new Error(`Channel ${channelId} not found or not text-capable`);
      }
    },
  };
}
