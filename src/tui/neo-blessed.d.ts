// Declaration file to resolve TS7016 — neo-blessed has no types
// Provides type compatibility by re-exporting blessed types
declare module 'neo-blessed' {
  import blessed from 'blessed';
  export default blessed;
  export * from 'blessed';
}
