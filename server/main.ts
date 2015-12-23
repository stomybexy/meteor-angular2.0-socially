import {loadParties} from './load_parties';
import './parties';
import './users';

Meteor.startup(loadParties);
