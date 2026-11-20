'use strict';
const { Client: SSHClient } = require('ssh2');
// Experimental development transport. Does not implement VPN enforcement.
function attachExperimentalSsh(socket, logger) {
  // ─── Web SSH Proxy ───
  let sshClient = null;
  let sshStream = null;

  socket.on('ssh_connect', (creds) => {
    if (!['admin', 'superadmin'].includes(socket.data.user.role) || !creds || typeof creds.host !== 'string' || typeof creds.username !== 'string') {
      socket.disconnect(true); return;
    }
    logger.info({ event: 'ssh.requested', socketId: socket.id });
    sshClient = new SSHClient();

    sshClient.on('ready', () => {
      socket.emit('ssh_status', 'SSH Connection ready. Starting shell...');
      sshClient.shell((err, stream) => {
        if (err) {
          socket.emit('ssh_status', `Shell error: ${err.message}`);
          return;
        }
        sshStream = stream;
        socket.emit('ssh_status', 'Connected successfully.\r\n');

        stream.on('data', (d) => socket.emit('ssh_data', d.toString('utf-8')));
        stream.on('close', () => {
          socket.emit('ssh_status', '\r\nConnection closed.');
          sshClient.end();
        });
      });
    }).on('error', (err) => {
      socket.emit('ssh_status', `SSH Error: ${err.message}`);
    }).connect({
      host: creds.host,
      port: creds.port || 22,
      username: creds.username,
      password: creds.password || undefined // In production, fetch safely or use keys
    });
  });

  socket.on('ssh_data', (data) => {
    if (sshStream) sshStream.write(data);
  });

  socket.on('ssh_resize', ({ rows, cols }) => {
    if (sshStream) sshStream.setWindow(rows, cols, 0, 0);
  });

  socket.on('disconnect', () => {
    if (sshClient) sshClient.end();
  });
}
module.exports = { attachExperimentalSsh };
