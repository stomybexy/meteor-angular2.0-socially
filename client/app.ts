import {Component, View, NgZone} from 'angular2/core';

import {Parties} from 'collections/parties';

import {bootstrap} from 'angular2-meteor';

@Component({
    selector: 'app'
})
@View({
    templateUrl: 'client/app.html'
})
class Socially {
    parties: Mongo.Cursor<Object>;

    constructor () {
        this.parties = Parties.find();
    }
}

bootstrap(Socially);
