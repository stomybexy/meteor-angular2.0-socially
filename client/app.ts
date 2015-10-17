import {Component, View, NgZone} from 'angular2/core';

import {Parties} from 'collections/parties';

import {bootstrap} from 'angular2-meteor';

import {PartiesForm} from 'client/parties-form/parties-form';

@Component({
    selector: 'app'
})
@View({
    templateUrl: 'client/app.html',
    directives: [PartiesForm]
})
class Socially {
    parties: Mongo.Cursor<Object>;

    constructor () {
        this.parties = Parties.find();
    }

    removeParty(party) {
        Parties.remove(party._id);
    }
}

bootstrap(Socially);
