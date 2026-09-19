import { createApp } from './app.js';
createApp().listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log('http://localhost:' + (process.env.PORT || 3000)));

