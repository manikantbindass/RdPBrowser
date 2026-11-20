"""Return the TCP peer address observed beyond the WireGuard gateway."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import socket
import sys


class Observer(BaseHTTPRequestHandler):
    def do_GET(self):
        source = self.headers.get("X-Forwarded-For", "") if len(sys.argv) == 4 else self.client_address[0]
        body = source.encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


class ObserverV6(ThreadingHTTPServer):
    address_family = socket.AF_INET6


address = sys.argv[1]
server = ObserverV6 if ":" in address else ThreadingHTTPServer
server((address, int(sys.argv[2])), Observer).serve_forever()
