// IPC is inherited from the trusted service parent; it is not a network route.
process.on('message',message => {
  if(message?.type==='benaa-shutdown') process.emit('SIGTERM');
});
