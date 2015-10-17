import {Component, View} from 'angular2/core';

import {Parties} from 'collections/parties';

import {PartiesForm} from 'client/parties-form/parties-form';

@Component({
    selector: 'parties-list'
})
@View({
    templateUrl: '/client/parties-list/parties-list.html',
    directives: [PartiesForm]
})
export class PartiesList {
    parties: Mongo.Cursor<Object>;

    constructor() {
        this.parties = Parties.find();
    }

    removeParty(party) {
        Parties.remove(party._id);
    }
}
