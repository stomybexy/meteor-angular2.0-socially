function PartiesList() {

  var self = this;

  this.selectedParty = {
    name: '',
    description: ''
  };

  Tracker.autorun(zone.bind(function () {
    self.parties = Parties.find({}).fetch();
  }));

  this.addParty = function(name, description) {
    Parties.insert({
      name: name,
      description: description
    });
  };

  this.remove = function(party) {
    Parties.remove(party._id);
  };

  this.selectParty = function(party){
    this.selectedParty = party;
  };

  this.saveParty = function(name, description){
    Parties.update(this.selectedParty._id, {$set: {name: name, description: description}});
  };
}
PartiesList.annotations = [
  new angular.Component({
    selector: "parties-list"
  }),
  new angular.View({
    templateUrl: 'client/parties-list.ng.html',
    directives: [angular.For, angular.If]
  })
];
document.addEventListener("DOMContentLoaded", function() {
  angular.bootstrap(PartiesList);
});

/*
 this.elem.domElement.querySelector('aria-menubar').getAttribute('value');
 */