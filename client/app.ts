import {MeteorApp, App, NavProvider} from 'socially'; 

@MeteorApp()
class Socially extends App {
    constructor(navProvider: NavProvider) {
        super(navProvider);
    }
}

