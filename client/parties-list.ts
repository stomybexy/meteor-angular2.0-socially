import {Component, View, bootstrap, For, If } from 'angular2/angular2';
import { bind, Injector, Injectable } from 'angular2/di';
import { Router, RouterOutlet, RouterLink } from 'angular2/router';
import { RouteParams } from 'angular2/src/router/instruction';
import { RootRouter } from 'angular2/src/router/router';
import { Pipeline } from 'angular2/src/router/pipeline';
import {ElementRef} from 'angular2/angular2';
import {Location} from 'angular2/src/router/location';
import {ElementRef} from 'angular2/core';

import {RouteRegistry} from 'angular2/src/router/route_registry';

@Injectable()
class PartiesHolder {
    private id;

    set currentPartyId(id) {
        this.id = id;
    }

    get currentPartyId() {
        return this.id;
    }
}

@Component({
    selector: 'parties-list'
})
@View({
    templateUrl: System.baseURL + 'client/parties-list.ng.html',
    directives: [For, If, RouterOutlet, RouterLink]
})
class PartiesList {
    selectedParty: Object = {
        name: '',
        description: ''
    };

    parties: Object;

    constructor() {
        var self = this;
        Tracker.autorun(zone.bind(function () {
            self.parties = Parties.find({}).fetch();
        }));
    }

    addParty(name: string, description: string) {
        Parties.insert({
            name: name,
            description: description
        });
    }

    remove(party: Object) {
        Parties.remove(party._id);
    }

    selectParty(party: Object) {
        this.selectedParty = party;
    }

    saveParty(name: string, description: string) {
        Parties.update(this.selectedParty._id, {$set: {name: name, description: description}});
    }
}

@Component({
    selector: 'party-details',
    injectables : [RouteParams]
})
@View({
    templateUrl: System.baseURL +'client/party-details.ng.html'
})
class PartyDetails {
    message : string;

    constructor(params:RouteParams) {
        console.log(params);
        this.message = 'Hello World';
    }
}

bootstrap(PartiesList, [
    Location,
    Pipeline,
    PartiesHolder,
    RouteParams,
    RouteRegistry,
    bind(Router).toFactory((registry, pipeline, location) => {
        return new RootRouter(registry, pipeline, location, PartiesList);
    }, [RouteRegistry, Pipeline, Location])
]).then(function(componentRef) {
    let router = componentRef.injector.get(Router);
    router.config({'path': '/party/:id', 'component': PartyDetails, 'as' : 'party'})
});