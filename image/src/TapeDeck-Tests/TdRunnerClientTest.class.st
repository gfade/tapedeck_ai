"
I test TdRunnerClient against a stub runner: a ZnServer I start on a free port that answers the runner's HTTP API (INTERFACES.md §5.5) with the fixture store's JSON and records what it was sent.
"
Class {
	#name : 'TdRunnerClientTest',
	#superclass : 'TdTestCase',
	#instVars : [
		'stub',
		'client',
		'requests'
	],
	#category : 'TapeDeck-Tests',
	#package : 'TapeDeck-Tests'
}

{ #category : 'stub runner' }
TdRunnerClientTest >> json: aValue [

	^ ZnResponse ok: (ZnEntity with: (TdJson toString: aValue) type: ZnMimeType applicationJson)
]

{ #category : 'stub runner' }
TdRunnerClientTest >> lastBody [
	"The JSON body of the last POST the stub received (the client follows each POST with GETs)."

	^ TdJson fromString: (requests reversed detect: [ :each | each method = #POST ]) contents
]

{ #category : 'stub runner' }
TdRunnerClientTest >> notFound: aString [

	^ (ZnResponse statusCode: 404)
		  entity: (ZnEntity with: (TdJson toString: (OrderedDictionary new
						     at: 'error' put: aString;
						     yourself)) type: ZnMimeType applicationJson);
		  yourself
]

{ #category : 'stub runner' }
TdRunnerClientTest >> respondTo: aRequest [

	| path |
	requests add: aRequest.
	path := '/' join: (aRequest uri pathSegments select: [ :each | each isString and: [ each notEmpty ] ]).
	aRequest method = #POST ifTrue: [ ^ self respondToPost: path ].
	path = 'api/health' ifTrue: [
		^ self json: (TdJson fromString: '{"ok":true,"version":"0.1.0","pi":"0.87.1","store":"/stub/store"}') ].
	path = 'api/tasks' ifTrue: [
		^ self json: (TdJson fromString:
				   '[{"id":"t01","title":"sum() subtracts","split":"held-in","quirk":"test-command","prompt":"Fix it."}]') ].
	path = 'api/variants' ifTrue: [ ^ self json: { self variantDictionary } ].
	path = 'api/runs' ifTrue: [ ^ self json: (self store runs reversed collect: [ :each | each info ]) ].
	path = 'api/reports' ifTrue: [ ^ self json: self store reportNames asArray ].
	(path beginsWith: 'api/reports/') ifTrue: [
		^ self json: (self store reportNamed: (path allButFirst: 'api/reports/' size)) ].
	(path beginsWith: 'api/runs/') ifTrue: [ ^ self respondToRun: ((path allButFirst: 'api/runs/' size) substrings: '/') ].
	^ self notFound: 'no route ' , path
]

{ #category : 'stub runner' }
TdRunnerClientTest >> respondToPost: aPath [

	aPath = 'api/runs' ifTrue: [ ^ self json: self rerun info ].
	aPath = 'api/forks' ifTrue: [ ^ self json: self fork info ].
	aPath = 'api/replays' ifTrue: [ ^ self json: self replay info ].
	aPath = 'api/gate' ifTrue: [ ^ self json: self gateReport ].
	^ self notFound: 'no route ' , aPath
]

{ #category : 'stub runner' }
TdRunnerClientTest >> respondToRun: someSegments [

	| run |
	run := self store runWithId: someSegments first.
	run ifNil: [ ^ self notFound: 'no run ' , someSegments first ].
	someSegments size = 1 ifTrue: [
		^ self json: ((TdJson copy: run info)
				   at: 'report' put: run report;
				   yourself) ].
	someSegments second = 'session' ifTrue: [
		^ ZnResponse ok:
			  (ZnEntity with: run session location contents type: 'application/x-ndjson' asZnMimeType) ].
	someSegments second = 'tape' ifTrue: [ ^ self json: (TdTape fromRun: run) asDictionary ].
	^ self notFound: 'no route'
]

{ #category : 'running' }
TdRunnerClientTest >> setUp [

	super setUp.
	self store.
	requests := OrderedCollection new.
	stub := (ZnServer on: 0)
		        bindingAddress: #[ 127 0 0 1 ];
		        yourself.
	stub onRequestRespond: [ :request | self respondTo: request ].
	stub start.
	client := TdRunnerClient new
		          baseUrl: 'http://127.0.0.1:' , stub port printString , '/';
		          timeout: 10;
		          yourself
]

{ #category : 'running' }
TdRunnerClientTest >> tearDown [

	stub ifNotNil: [ stub stop ].
	super tearDown
]

{ #category : 'tests' }
TdRunnerClientTest >> testErrorsBecomeRunnerErrors [

	| unreachable |
	self should: [ client run: 'no-such-run' ] raise: TdRunnerError.
	[ client run: 'no-such-run' ]
		on: TdRunnerError
		do: [ :error |
			self assert: error statusCode equals: 404.
			self assert: (error messageText includesSubstring: 'no run') ].
	unreachable := TdRunnerClient new
		               baseUrl: 'http://127.0.0.1:1';
		               timeout: 5;
		               yourself.
	self should: [ unreachable health ] raise: TdRunnerError
]

{ #category : 'tests' }
TdRunnerClientTest >> testForkAtAStep [

	| fork body |
	fork := client forkRun: self baseline variant: 'rule-taskrunner' at: (self baseline stepAt: 4) lenient: #( 'system' ).
	body := self lastBody.
	self assert: (body at: 'from') equals: self baseline id.
	self assert: (body at: 'variant') equals: 'rule-taskrunner'.
	self assert: (body at: 'forkAt') equals: 4.
	self assert: (body at: 'lenient') equals: #( 'system' ).
	self assert: fork isFork.
	self assert: fork id equals: self fork id.
	self assert: fork stepCount equals: self fork stepCount.
	self assert: fork divergence step equals: 4
]

{ #category : 'tests' }
TdRunnerClientTest >> testForkAutoAndFromATape [

	client forkRun: self baseline id variant: (TdVariant named: 'rule-taskrunner') auto: true.
	self assert: (self lastBody at: 'auto') equals: true.
	self assert: (self lastBody at: 'variant') equals: 'rule-taskrunner'.
	self deny: (self lastBody includesKey: 'forkAt').
	client forkRun: self baseline variant: 'rule-taskrunner' tape: (TdTape fromRun: self baseline).
	self assert: ((self lastBody at: 'tape') at: 'format') equals: 'tapedeck.tape/v1'
]

{ #category : 'tests' }
TdRunnerClientTest >> testHealthTasksAndVariants [

	| variant |
	self assert: (client health at: 'ok').
	self assert: (client tasks first at: 'id') equals: 't01'.
	variant := client variants first.
	self assert: variant name equals: 'rule-taskrunner'.
	self assert: (variant forkStepFor: self baseline) index equals: 4.
	self assert: (client variantNamed: 'rule-taskrunner') notNil.
	self assert: (client variantNamed: 'no-such-variant') isNil
]

{ #category : 'tests' }
TdRunnerClientTest >> testImportStore [

	| imported |
	imported := client importStore.
	self assert: imported size equals: self store size.
	self assert: imported reportNames asArray equals: self store reportNames asArray.
	self assert: ((imported runWithId: self fork id) parent) id equals: self baseline id
]

{ #category : 'tests' }
TdRunnerClientTest >> testReplayWithAnEditedTape [

	| tape replay |
	tape := TdTape fromRun: self baseline.
	tape editToolCall: (self baseline stepAt: 4) tools first id command: './tasks test'.
	replay := client replayRun: self baseline variant: 'guard-secrets' tape: tape.
	self assert: replay isReplay.
	self assert: (self lastBody at: 'variant') equals: 'guard-secrets'.
	self assert: ((self lastBody at: 'tape') at: 'edits') size equals: 1
]

{ #category : 'tests' }
TdRunnerClientTest >> testRunConveniencesUseTheDefaultClient [

	| fork replay |
	TdRunnerClient default: client during: [
		fork := self baseline forkAt: (self baseline stepAt: 4) with: (TdVariant named: 'rule-taskrunner').
		self assert: (self lastBody at: 'forkAt') equals: 4.
		self deny: (self lastBody includesKey: 'lenient').
		replay := self baseline replayWith: 'guard-secrets' tape: (TdTape fromRun: self baseline) ].
	self assert: fork isFork.
	self assert: (self store runWithId: fork id) == fork.
	self assert: replay isReplay.
	self assert: TdRunnerClient default ~~ client
]

{ #category : 'tests' }
TdRunnerClientTest >> testRunImportsTheSession [

	| run |
	run := client run: self baseline id.
	self assert: run id equals: self baseline id.
	self assert: run stepCount equals: self baseline stepCount.
	self assert: run failed.
	self assert: run tokens equals: self baseline tokens.
	self assert: (run stepAt: 4) tools first command equals: 'npm test'.
	self assert: run report notNil.
	self assert: (client sessionOf: self baseline) tapeSteps size equals: self baseline stepCount.
	self assert: (client tapeOf: self fork id) stepCount equals: self fork stepCount
]

{ #category : 'tests' }
TdRunnerClientTest >> testRunsAndSummaries [

	self assert: client runSummaries size equals: self store size.
	self
		assert: (client runs collect: [ :each | each id ]) asArray
		equals: (self store runs collect: [ :each | each id ]) asArray.
	client runSummariesWhere: (OrderedDictionary new
			 at: 'kind' put: 'fork';
			 yourself).
	self assert: (requests last uri queryAt: 'kind') equals: 'fork'
]

{ #category : 'tests' }
TdRunnerClientTest >> testStartRunAndGate [

	| run table |
	run := client startRunTask: 't01' variant: 'rule-taskrunner'.
	self assert: (self lastBody at: 'task') equals: 't01'.
	self assert: (self lastBody at: 'variant') equals: 'rule-taskrunner'.
	self assert: run id equals: self rerun id.
	table := client gateBaseline: 'vanilla' candidate: 'rule-taskrunner'.
	self assert: (self lastBody at: 'baseline') equals: 'vanilla'.
	self assert: (self lastBody at: 'candidate') equals: 'rule-taskrunner'.
	self assert: table agreement equals: ((self gateReport at: 'summary') at: 'agreement').
	self assert: client reports equals: self store reportNames asArray.
	self assert: (client reportNamed: client reports first) n equals: table n
]

{ #category : 'stub runner' }
TdRunnerClientTest >> variantDictionary [

	^ TdJson fromString:
		  '{"name":"rule-taskrunner","description":"Prompt rule","rules":["Run tests with ./tasks test."],"fork":{"lenient":["system"],"at":{"tool":"bash","argMatches":{"command":"^npm "}}}}'
]
