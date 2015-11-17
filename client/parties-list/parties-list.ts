import {Component, View} from 'angular2/core';

import {Parties} from 'collections/parties';

import {PartiesForm} from 'client/parties-form/parties-form';

import {RouterLink} from 'angular2/router';

@Component({
    selector: 'parties-list'
})
@View({
    templateUrl: '/client/parties-list/parties-list.html',
    directives: [PartiesForm, RouterLink]
})
export class PartiesList {
    parties: Mongo.Cursor<Party>;

    constructor() {
        this.parties = Parties.find();
    }

    removeParty(party) {
        Parties.remove(party._id);
    }
}
