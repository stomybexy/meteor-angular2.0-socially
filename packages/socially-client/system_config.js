System.config({
  packages: {
    'socially-client': {
      main: 'main',
      format: 'register',
      map: {
        '.': System.normalizeSync('{socially-client}')
      }
    }
  }
});
