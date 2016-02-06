
import {Injectable, Type} from 'angular2/core';

import {NavController, IonicApp} from 'ionic/ionic';

import {MeteorApp as MeteorAppBase} from 'ionic2-meteor';

import {PartiesList} from './client/parties-list/parties-list';

import {LoginPage} from './client/login/login-page';

@Injectable()
export class NavProvider {
    constructor(private app: IonicApp) {}

    get(): NavController {
        return this.app.getComponent('nav');;
    }
}

export function MeteorApp() {
    return MeteorAppBase({
        templateUrl: '/packages/socially-mobile/client/app.html',
        providers: [NavProvider]
    });
}

export class App {
    partiesList: Type;
    login: Type;
    navProvider: NavProvider;

    constructor(navProvider: NavProvider) {
        this.navProvider = navProvider;
        this.login = LoginPage;
        this.partiesList = PartiesList;
    }

    openPage(page) {
        let nav = this.navProvider.get();
        nav.push(page);
    }
}
