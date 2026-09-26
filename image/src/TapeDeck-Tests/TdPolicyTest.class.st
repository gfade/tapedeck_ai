"
I test TdPolicy and its rules: what a policy would have blocked among recorded tool calls, without any model call.
"
Class {
	#name : 'TdPolicyTest',
	#superclass : 'TdTestCase',
	#category : 'TapeDeck-Tests',
	#package : 'TapeDeck-Tests'
}

{ #category : 'fixtures' }
TdPolicyTest >> call: aToolName args: aJsonString [

	^ TdToolCall new
		  name: aToolName;
		  args: (TdJson fromString: aJsonString);
		  yourself
]

{ #category : 'fixtures' }
TdPolicyTest >> npmPolicy [

	^ TdPolicy new
		  denyCommand: '^npm (test|run test)';
		  yourself
]

{ #category : 'tests' }
TdPolicyTest >> testDenyCommandBlocksTheBaselineNpmCall [

	| policy call |
	policy := self npmPolicy.
	call := (self baseline stepAt: 4) tools first.
	self assert: (policy denies: call).
	self
		assert: (policy reasonFor: call)
		equals: 'Blocked by tapedeck policy: denyCommands ^npm (test|run test)'.
	self assert: (policy blockedCallsIn: self baseline) asArray equals: { call }.
	self assert: (policy firstBlockedCallIn: self baseline) equals: call.
	self assert: (self baseline blockedCallsUnder: policy) asArray equals: { call }.
	self assert: (policy allows: (self baseline stepAt: 1) tools first).
	self assert: (policy reasonFor: (self baseline stepAt: 1) tools first) isNil
]

{ #category : 'tests' }
TdPolicyTest >> testDenyPath [

	| policy |
	policy := TdPolicy new
		          denyPath: '(^|/)\.env$';
		          yourself.
	self assert: (policy denies: (self call: 'read' args: '{"path":".env"}')).
	self assert: (policy denies: (self call: 'edit' args: '{"path":"config/.env"}')).
	self deny: (policy denies: (self call: 'read' args: '{"path":"src/.envrc"}')).
	self assert: (policy denies: (self call: 'bash' args: '{"command":"cat .env | head"}')).
	self assert: (policy denies: (self call: 'bash' args: '{"command":"source \"./.env\""}')).
	self deny: (policy denies: (self call: 'bash' args: '{"command":"ls"}')).
	self deny: (policy denies: (self call: 'bash' args: '{}'))
]

{ #category : 'tests' }
TdPolicyTest >> testFromVariantDictionary [

	| policy |
	policy := TdPolicy fromVariantDictionary: (TdJson fromString:
			           '{"name":"guard","policy":{"denyCommands":["(^|[\\s;&|(])(curl|wget)(\\s|$)"],"denyPaths":["(^|/)\\.env$"]}}').
	self assert: policy rules size equals: 2.
	self assert: (policy denies: (self call: 'bash' args: '{"command":"ls && curl http://x"}')).
	self deny: (policy denies: (self call: 'bash' args: '{"command":"curly"}')).
	self assert: (policy denies: (self call: 'read' args: '{"path":".env"}')).
	self assert: (TdPolicy fromVariantDictionary: policy asDictionary) rules size equals: 2.
	self assert: (TdPolicy fromVariantDictionary: (TdJson fromString: '{"name":"vanilla"}')) isEmpty
]

{ #category : 'tests' }
TdPolicyTest >> testNonCapturingGroups [

	| policy |
	policy := TdPolicy new
		          denyCommand: '^(?:npm|pnpm) test';
		          yourself.
	self assert: (policy denies: (self call: 'bash' args: '{"command":"pnpm test"}')).
	self deny: (policy denies: (self call: 'bash' args: '{"command":"yarn test"}'))
]

{ #category : 'tests' }
TdPolicyTest >> testWhatIfOverTheStore [

	| blocked |
	blocked := self npmPolicy blockedCallsIn: self store.
	self deny: blocked isEmpty.
	self assert: (blocked allSatisfy: [ :each | each command beginsWith: 'npm' ]).
	self assert: ((blocked collect: [ :each | each run ]) includes: self baseline).
	self assert: ((blocked collect: [ :each | each run ]) includes: self replay).
	self assert: (self npmPolicy blockedCallsIn: self rerun) isEmpty.
	self assert: (self npmPolicy blockedCallsIn: { self baseline. self rerun }) size equals: 1
]
