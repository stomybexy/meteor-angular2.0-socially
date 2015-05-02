function PartiesList() {

  var self = this;
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