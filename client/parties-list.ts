import {Component, View, bootstrap, For, If} from 'angular2/angular2';
import {Parties} from 'model/parties';

@Component({
    selector: 'parties-list'
})
@View({
    templateUrl: 'client/parties-list.ng.html',
    directives: [For, If]
})
class PartiesList {
    selectedParty: Object = {
        name: '',
        description: ''
    };

    parties: Object;

    constructor() {
        var self = this;
        Tracker.autorun(zone.bind(function () {
            self.parties = Parties.find({}).fetch();
        }));
    }

    addParty(name: string, description: string) {
        Parties.insert({
            name: name,
            description: description
        });
    }

    remove(party: Object) {
        Parties.remove(party._id);
    }

    selectParty(party: Object) {
        this.selectedParty = party;
    }

    saveParty(name: string, description: string) {
        Parties.update(this.selectedParty._id, {$set: {name: name, description: description}});
    }
}

bootstrap(PartiesList);