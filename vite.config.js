module.exports = async () => {
  const { default: react } = await import('@vitejs/plugin-react');
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': 'http://localhost:3000'
      }
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true
    }
  };
};
