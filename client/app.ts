import {Component, View} from 'angular2/core';

import {bootstrap} from 'angular2/platform/browser';

@Component({
    selector: 'app'
})
@View({
    templateUrl: 'client/app.html'
})
class Socially { }

bootstrap(Socially);
