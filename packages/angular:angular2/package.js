Package.describe({
  name: "angular:angular2",
  summary: "The simplest no-conflict way to use AngularJS with Meteor, Meteorite and Atmosphere Smart Packages.",
  version: "2.0.0-alpha.19",
  git: "https://github.com/Urigo/angular-meteor.git"
});

Package.on_use(function (api) {
  api.versionsFrom('METEOR@0.9.0.1');

  api.use('angular-ts', 'client');

  // Files to load in Client only.
  api.add_files([
    // Lib Files
    'angular2-bundle.js'
  ], 'client');
});