
import {NavController, Page} from 'ionic/ionic';

import {Component} from 'angular2/core';

import {Router} from 'angular2/router';

import {AccountsService, InjectUser} from 'meteor-accounts';

@Page({
  templateUrl: '/packages/socially-mobile/client/login/login-page.html',
  providers: [AccountsService]
})
export class LoginPage {
  phoneNumber: string;
  verCode: string;
  phoneStage: boolean = true;

  constructor(private nav: NavController,
              private accounts: AccountsService) {}

  requestVerification() {
    Accounts.requestPhoneVerification(this.phoneNumber);
    this.phoneStage = false;
  }

  verifyPhone() {
    Accounts.verifyPhone(this.phoneNumber, this.verCode, (err) => {
      if (!err) {
        this.nav.pop();
      }
    });
  }

  logout() {
    this.accounts.logout();
  }
}
