import {Component, View} from 'angular2/core';

import {PartiesForm as PartiesFormBase} from 'socially-client';

@Component({
  selector: 'parties-form'
})
@View({
  templateUrl: '/packages/socially-browser/client/parties-form/parties-form.html'
})
export class PartiesForm extends PartiesFormBase {}
