import {Component, View} from 'angular2/core';

import {Parties} from 'collections/parties';

import {PartiesForm} from 'client/parties-form/parties-form';

import {RouterLink} from 'angular2/router';

import {AccountsUI} from 'meteor-accounts-ui';

import {MeteorComponent} from 'angular2-meteor';

@Component({
    selector: 'parties-list'
})
@View({
    templateUrl: '/client/parties-list/parties-list.html',
    directives: [PartiesForm, RouterLink, AccountsUI]
})
export class PartiesList extends MeteorComponent {
    parties: Mongo.Cursor<Party>;
    pageSize: number = 10;
    curPage: number = 1;
    nameOrder: number = 1;

    constructor() {
        super();
        let options = { 
            limit: this.pageSize,
            skip: (this.curPage - 1) * this.pageSize,
            sort: { name: this.nameOrder }
        }
        this.subscribe('parties', options, () => {
            this.parties = Parties.find();
        }, true);
    }

    removeParty(party) {
        Parties.remove(party._id);
    }

    search(value: string) {
        if (value) {
            this.parties = Parties.find({ location: value });
        } else {
            this.parties = Parties.find();
        }
    }
}
