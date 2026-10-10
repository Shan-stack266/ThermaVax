const createApp = require('./server/app');

const app = createApp();
const port = Number(process.env.PORT) || 3000;

app.listen(port, () => {
  console.log(`ThermaVax is running at http://localhost:${port}`);
  console.log('Database: Supabase');
});
