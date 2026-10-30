import getPort from 'get-port' ;
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
	(async () => { const port = await getPort({port: 13604}); console.log(port);})();

	console.log('Congratulations, your extension "vscode-test-getport" is now active!');
	let disposable = vscode.commands.registerCommand('vscode-test-getport.showPort', () => {
		vscode.window.showInformationMessage('Hello from vscode-test-getport!');
	});

	context.subscriptions.push(disposable);
}

export function deactivate() {}
