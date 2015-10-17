import {Component, View, NgZone} from 'angular2/core';

import {bootstrap} from 'angular2-meteor';

import {ROUTER_PROVIDERS, ROUTER_DIRECTIVES, RouteConfig} from 'angular2/router';

@Component({
    selector: 'app'
})
@View({
    directives: [ROUTER_DIRECTIVES]
})
class Socially {}

bootstrap(Socially, [ROUTER_PROVIDERS]);
