import {MeteorApp, App, NavProvider} from 'socially'; 

import 'pubs/parties';

@MeteorApp()
class Socially extends App {
    constructor(navProvider: NavProvider) {
        super(navProvider);
    }
}

