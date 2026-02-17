const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3333;

app.use(express.static(path.join(__dirname, 'public')));

function start() {
  app.listen(PORT, () => {
    console.log(`Nostr WoT Feed server running at http://localhost:${PORT}`);
  });
}

module.exports = { start };
