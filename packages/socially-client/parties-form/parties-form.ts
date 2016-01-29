
import {FormBuilder, Control, ControlGroup, Validators} from 'angular2/common';

import {Parties} from 'collections/parties';

export class PartiesForm {
    partiesForm: ControlGroup;

    constructor() {
        var fb = new FormBuilder();
        this.partiesForm = fb.group({
            name: ['', Validators.required],
            description: [''],
            location: ['', Validators.required],
            public: [false]
        });
    }

    addParty(party) {
        if (this.partiesForm.valid) {
            if (Meteor.userId()) {
                Parties.insert({
                    name: party.name,
                    description: party.description,
                    location: {
                        name: party.location
                    },
                    public: party.public,
                    owner: Meteor.userId()
                });

                (<Control>this.partiesForm.controls['name']).updateValue('');
                (<Control>this.partiesForm.controls['description']).updateValue('');
                (<Control>this.partiesForm.controls['location']).updateValue('');
                (<Control>this.partiesForm.controls['public']).updateValue(false);
            } else {
                alert('Please log in to add a party');
            }
        }
    }
}
