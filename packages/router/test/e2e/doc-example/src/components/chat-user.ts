import { inject } from '@aurelia//kernel';
import { customElement } from '@aurelia/runtime';
import { UsersRepository } from '../repositories/users';

@customElement({ name: 'chat-user', template: `<template>
<p>Chatting with <strong>\${user.id} (\${user.name})</strong><p>
<p>You: Hello!</p>
<p><input></p>
</template>` })
@inject(UsersRepository)
export class ChatUser {
  public static parameters = ['id'];

  public user = {};
  constructor(private readonly usersRepository: UsersRepository) { }

  public enter(parameters) {
    if (parameters.id) {
      this.user = this.usersRepository.user(parameters.id);
    }
  }
}
