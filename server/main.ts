import {loadParties} from './load-parties';
import './parties';
import './users';

Meteor.startup(loadParties);
