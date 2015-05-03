//TypeScript
import {Component, View, bootstrap, For, If} from 'angular2/angular2';
import * as add from 'client/exporter';

@Component({
  selector: 'todo-list'
})
@View({
  templateUrl: 'client/todo.tpl',
  directives: [For, If]
})
class TodoList {
  todos: Array;

  constructor() {
    this.todos = ["Eat Breakfast", "Walk Dog", "Breathe"];
    console.log(add(2,5));
  }

  addTodo(todo: string) {
    this.todos.push(todo);
  }

  doneTyping($event) {
    if($event.which === 13) {
      this.addTodo($event.target.value);
      $event.target.value = null;
    }
  }
}

bootstrap(TodoList);