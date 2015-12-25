import {loadParties} from './load_parties';
import './parties';
import './users';
import 'collections/methods';

Meteor.startup(loadParties);
