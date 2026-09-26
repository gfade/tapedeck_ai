"
I test TdServer: I start it on a free port, GET each route, and stop it.
"
Class {
	#name : 'TdServerTest',
	#superclass : 'TdTestCase',
	#instVars : [
		'server'
	],
	#category : 'TapeDeck-Tests',
	#package : 'TapeDeck-Tests'
}

{ #category : 'running' }
TdServerTest >> get: aPath [

	| client |
	client := ZnClient new.
	^ [
	  client
		  url: server url , aPath;
		  get.
	  client response ] ensure: [ client close ]
]

{ #category : 'running' }
TdServerTest >> getJson: aPath [

	| response |
	response := self get: aPath.
	self assert: response isSuccess.
	self assert: response contentType sub equals: 'json'.
	^ TdJson fromString: response contents
]

{ #category : 'running' }
TdServerTest >> setUp [

	super setUp.
	server := (TdServer on: self store)
		          port: 0;
		          start
]

{ #category : 'running' }
TdServerTest >> tearDown [

	server ifNotNil: [ server stop ].
	super tearDown
]

{ #category : 'tests' }
TdServerTest >> testComparisons [

	| comparisons |
	comparisons := self getJson: '/comparisons'.
	self assert: (comparisons at: 'rows') size equals: (TdComparisonTable forStore: self store) n.
	self assert: (((comparisons at: 'rows') collect: [ :each | each at: 'forkRun' ]) includes: self fork id).
	self assert: ((comparisons at: 'rows') first keys includesAll: #( 'baselineRun' 'forkUsage' 'agree' )).
	self
		assert: ((comparisons at: 'summary') at: 'agreement')
		equals: (TdComparisonTable forStore: self store) agreement.
	server comparisonTable: (self store comparisonTableForReport: (self gateReport at: 'name')).
	self assert: ((self getJson: '/comparisons') at: 'name') equals: (self gateReport at: 'name')
]

{ #category : 'tests' }
TdServerTest >> testEditedTapesWin [

	| note edited tape |
	note := String with: $c with: $a with: $f with: (Character value: 233).
	edited := TdTape fromRun: self baseline.
	edited editToolCall: (self baseline stepAt: 4) tools first id command: './tasks test' note: note.
	self store registerTape: edited.
	tape := self getJson: '/tapes/' , self baseline id.
	self assert: (tape at: 'edits') size equals: 1.
	self assert: ((tape at: 'edits') first at: 'note') equals: note.
	self assert: (((((tape at: 'steps') at: 4) at: 'tools') first at: 'args') at: 'command') equals: './tasks test'
]

{ #category : 'tests' }
TdServerTest >> testHealth [

	| health |
	health := self getJson: '/health'.
	self assert: (health at: 'ok').
	self assert: (health at: 'runs') equals: self store size
]

{ #category : 'tests' }
TdServerTest >> testListensOnLoopbackOnly [

	self assert: server isRunning.
	self assert: server bindingAddress equals: #[ 127 0 0 1 ].
	self assert: server port > 0.
	self assert: server url equals: 'http://127.0.0.1:' , server port printString
]

{ #category : 'tests' }
TdServerTest >> testOnlyGetIsServed [

	| client |
	client := ZnClient new.
	[
	client
		url: server url , '/runs';
		entity: (ZnEntity with: '{}' type: ZnMimeType applicationJson);
		post.
	self assert: client response code equals: 405 ] ensure: [ client close ]
]

{ #category : 'tests' }
TdServerTest >> testRuns [

	| runs baseline |
	runs := self getJson: '/runs'.
	self assert: runs size equals: self store size.
	self assert: runs first keys asArray equals: #( 'id' 'task' 'variant' 'kind' 'pass' 'steps' 'tokens' 'cost' ).
	baseline := runs detect: [ :each | (each at: 'id') = self baseline id ].
	self assert: (baseline at: 'kind') equals: 'run'.
	self assert: (baseline at: 'pass') equals: false.
	self assert: (baseline at: 'steps') equals: self baseline stepCount.
	self assert: (baseline at: 'tokens') equals: self baseline tokens.
	self assert: ((runs detect: [ :each | (each at: 'id') = self replay id ]) at: 'pass') isNil
]

{ #category : 'tests' }
TdServerTest >> testStopAndPortConflicts [

	| other |
	other := (TdServer on: self store) port: server port.
	self should: [ other start ] raise: Error.
	self deny: other isRunning.
	server stop.
	self deny: server isRunning
]

{ #category : 'tests' }
TdServerTest >> testTapes [

	| tape |
	tape := self getJson: '/tapes/' , self fork id.
	self assert: (tape at: 'format') equals: 'tapedeck.tape/v1'.
	self assert: (tape at: 'id') equals: self fork id.
	self assert: (tape at: 'steps') size equals: self fork stepCount.
	self assert: (tape at: 'edits') isEmpty
]

{ #category : 'tests' }
TdServerTest >> testTimeline [

	| timeline step tool |
	timeline := self getJson: '/runs/' , self baseline id , '/timeline'.
	self assert: timeline size equals: self baseline stepCount.
	step := timeline at: 4.
	self assert: step keys asArray equals: #( 'step' 'live' 'tools' 'tokens' 'cost' ).
	self assert: (step at: 'step') equals: 4.
	self assert: (step at: 'live') equals: true.
	self assert: (step at: 'tokens') equals: (self baseline stepAt: 4) tokens.
	tool := (step at: 'tools') first.
	self assert: tool keys asArray equals: #( 'name' 'summary' 'exec' 'isError' ).
	self assert: (tool at: 'summary') equals: '$ npm test'.
	self assert: (tool at: 'exec') equals: 'real'.
	self assert: (tool at: 'isError') equals: true
]

{ #category : 'tests' }
TdServerTest >> testUnknownRoutesAnswer404 [

	| response |
	response := self get: '/nope'.
	self assert: response code equals: 404.
	self assert: ((TdJson fromString: response contents) includesKey: 'error').
	self assert: (self get: '/runs/no-such-run/timeline') code equals: 404.
	self assert: (self get: '/tapes/no-such-tape') code equals: 404
]
