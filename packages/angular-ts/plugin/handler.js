Plugin.registerSourceHandler('tpl', {
  isTemplate: true,
  archMatching: "web"
}, function(compileStep) {
  var contents = compileStep.read().toString('utf8');

  compileStep.addAsset({
    path : compileStep.inputPath,
    data : contents
  });
});

var typescript = Npm.require('typescript');

Plugin.registerSourceHandler('ts.js', function(compileStep) {
  var output = typescript.transpile(compileStep.read().toString('utf8'), { module : typescript.ModuleKind.AMD });

  compileStep.addAsset({
    path : compileStep.inputPath.replace('.ts.js', '.js'),
    //sourcePath : compileStep.inputPath,
    data : output
  });
});