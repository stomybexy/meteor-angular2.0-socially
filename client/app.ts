import {Component, View, NgZone} from 'angular2/core';

import {bootstrap} from 'angular2/platform/browser';

import {Parties} from 'collections/parties';

@Component({
    selector: 'app'
})
@View({
    templateUrl: 'client/app.html'
})
class Socially {
    parties: Array<Object>;

    constructor (zone: NgZone) {
        Tracker.autorun(() => zone.run(() => {
            this.parties = Parties.find().fetch();
        }));
    }
}

bootstrap(Socially);
