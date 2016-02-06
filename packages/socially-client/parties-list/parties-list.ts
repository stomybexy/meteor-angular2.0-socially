
import {Parties} from 'collections/parties';

import {SmartMeteorComponent} from 'ng2-smart-sub';

import {MeteorComponent} from 'angular2-meteor';

export class PartiesList extends SmartMeteorComponent {
    parties: Mongo.Cursor<Party>;
    pageSize: number = 10;
    curPage: ReactiveVar<number> = new ReactiveVar<number>(1);
    // nameOrder: ReactiveVar<number> = new ReactiveVar<number>(1);
    sort: ReactiveVar<Object> = new ReactiveVar<Object>({
        name: 1
    })
    partiesSize: number = 0;
    location: ReactiveVar<string> = new ReactiveVar<string>(null);
    user: Meteor.User;

    constructor() {
        super();
        this.autorun(() => {
            console.log('Using smartPageSubscribe...');
            this.smartPageSubscribe('parties', null,  this.location.get());
        });

        this.autorun(() => {
            this.partiesSize = Counts.get('numberOfParties');
        }, true);
    }

    removeParty(party) {
        Parties.remove(party._id);
    }

    search(value: string) {
        this.curPage.set(1);
        this.location.set(value);
    }

    onPageChanged(page: number) {
        this.curPage.set(page);
    }

    changeSortOrder(nameOrder: string) {
        // this.nameOrder.set(parseInt(nameOrder));
        this.sort.set({
            name: parseInt(nameOrder)
        })
    }

    isOwner(party: Party): boolean {
        if (this.user) {
            return this.user._id === party.owner;
        }

        return false;
    }
}
