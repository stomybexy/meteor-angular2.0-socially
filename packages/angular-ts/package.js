Package.describe({
  name: 'angular-ts',
  version: '0.0.1',
  // Brief, one-line summary of the package.
  summary: '',
  // URL to the Git repository containing the source code for this package.
  git: '',
  // By default, Meteor will default to using README.md for documentation.
  // To avoid submitting documentation, set this field to null.
  documentation: 'README.md'
});

Package.registerBuildPlugin({
  name : 'ts',
  sources : [
    'plugin/handler.js',
  ],
  npmDependencies : {
    'typescript' : '1.5.0-beta'
  }
});

Package.onUse(function(api) {
  api.versionsFrom('1.1.0.2');
  api.addFiles(['traceur-runtime.js',
    'es6-module-loader@0.16.5.js',
    'system@0.16.7.js'], 'client');

  api.export('define');
});

Package.onTest(function(api) {
  api.use('tinytest');
  api.use('angular-ts');
  api.addFiles('angular-ts-tests.js');
});
