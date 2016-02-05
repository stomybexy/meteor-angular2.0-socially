import {Injectable, Component, View, provide} from 'angular2/core';

import {MeteorApp as MeteorAppBase} from 'angular2-meteor';

import {Router, ROUTER_PROVIDERS, ROUTER_DIRECTIVES, RouteConfig, APP_BASE_HREF} from 'angular2/router';

import {ANGULAR2_GOOGLE_MAPS_PROVIDERS} from 'ng2-google-maps/core';

import {PartiesList} from './client/parties-list/parties-list'; 

import {PartyDetails} from './client/party-details/party-details'; 

Accounts.ui.config({
  passwordSignupFields: 'USERNAME_AND_EMAIL'
});

@Injectable()
export class NavProvider {
    router: Router;

    constructor(router: Router) {
        this.router = router;
    }

    get(): Router {
        return this.router;
    }
}

export function MeteorApp() {
    return MeteorAppBase({
        template: '<router-outlet></router-outlet>',
        directives: [ROUTER_DIRECTIVES],
        providers: [NavProvider, ROUTER_PROVIDERS, ANGULAR2_GOOGLE_MAPS_PROVIDERS, provide(APP_BASE_HREF, { useValue: '/' })]
    });
}

export class App {
    constructor(navProvider: NavProvider) {
        let router = navProvider.get();
        router.config([
            {path: '/', component: PartiesList},
            {path: '/party/:partyId', as: 'PartyDetails', component: PartyDetails}
        ]);
    }
}

