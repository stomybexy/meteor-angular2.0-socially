import {Component, View} from 'angular2/core';

import {FormBuilder, ControlGroup, Validators} from 'angular2/common';

@Component({
    selector: 'parties-form'
})
@View({
    templateUrl: '/client/parties-form/parties-form.html'
})
export class PartiesForm {
    partiesForm: ControlGroup;

    constructor() {
        var fb = new FormBuilder();
        this.partiesForm = fb.group({
            name: ['', Validators.required],
            description: [''],
            location: ['', Validators.required]
        });
    }
}
