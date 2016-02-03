import {Component, View} from 'angular2/core';

import {RouterLink} from 'angular2/router';

import {AccountsUI} from 'meteor-accounts-ui';

import {InjectUser} from 'meteor-accounts';

import {PaginationService, PaginatePipe, PaginationControlsCpm} from 'ng2-pagination';

import {ANGULAR2_GOOGLE_MAPS_DIRECTIVES} from 'ng2-google-maps/core';

import {PartiesForm} from './../parties-form/parties-form';

import {Login} from './../login/login';

import {RsvpPipe, PartiesList as PartiesListBase} from 'socially-client';

@Component({
    selector: 'parties-list',
    viewProviders: [PaginationService]
})
@View({
    templateUrl: '/packages/socially-browser/client/parties-list/parties-list.html',
    directives: [ANGULAR2_GOOGLE_MAPS_DIRECTIVES, PartiesForm, RouterLink, Login, PaginationControlsCpm],
    pipes: [PaginatePipe, RsvpPipe]
})
@InjectUser()
export class PartiesList extends PartiesListBase {}
