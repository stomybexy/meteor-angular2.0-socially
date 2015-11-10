import {Component, View} from 'angular2/core';

import {Parties} from 'collections/parties';

import {PartiesForm} from 'client/parties-form/parties-form';

import {RouterLink} from 'angular2/router';

import {AccountsUI} from 'meteor-accounts-ui';

@Component({
    selector: 'parties-list'
})
@View({
    templateUrl: '/client/parties-list/parties-list.html',
    directives: [PartiesForm, RouterLink, AccountsUI]
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
