package protocol

import (
	"bufio"
	"encoding/json"
	"io"

	"github.com/sourcegraph/jsonrpc2"
)

type stdioReadWriteCloser struct {
	reader io.ReadCloser
	writer io.WriteCloser
}

func newStdioReadWriteCloser(r io.ReadCloser, w io.WriteCloser) *stdioReadWriteCloser {
	return &stdioReadWriteCloser{reader: r, writer: w}
}

func (s *stdioReadWriteCloser) Read(p []byte) (int, error) {
	return s.reader.Read(p)
}

func (s *stdioReadWriteCloser) Write(p []byte) (int, error) {
	return s.writer.Write(p)
}

func (s *stdioReadWriteCloser) Close() error {
	rErr := s.reader.Close()
	wErr := s.writer.Close()
	if rErr != nil {
		return rErr
	}
	return wErr
}

// lineCodec implements jsonrpc2.ObjectCodec for newline-delimited JSON.
// Each message is a single JSON object followed by a newline character.
// This matches the TS backend's output format.
type lineCodec struct{}

func (lineCodec) WriteObject(stream io.Writer, obj interface{}) error {
	data, err := json.Marshal(obj)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	_, err = stream.Write(data)
	return err
}

func (lineCodec) ReadObject(stream *bufio.Reader, v interface{}) error {
	line, err := stream.ReadBytes('\n')
	if err != nil {
		return err
	}
	return json.Unmarshal(line, v)
}

func newObjectStream(r io.ReadCloser, w io.WriteCloser) jsonrpc2.ObjectStream {
	rwc := newStdioReadWriteCloser(r, w)
	return jsonrpc2.NewBufferedStream(rwc, lineCodec{})
}
