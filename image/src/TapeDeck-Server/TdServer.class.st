"
I serve what the image holds as JSON on http://127.0.0.1:4778 (INTERFACES.md §7), so other programs can read it: pi-tape fetches tapes through PI_TAPE_SOURCE, including tapes edited in the image. I listen on the loopback interface only.

	server := TdServer startOn: store.	""port 4778""
	server url.
	server stop.

Routes (GET only):
- /health: {ok, runs}
- /runs: [{id, task, variant, kind, pass, steps, tokens, cost}]
- /runs/<id>/timeline: [{step, live, tools: [{name, summary, exec, isError}], tokens, cost}]
- /tapes/<id>: tape JSON; a tape registered in the store (store registerTape: aTape) wins over the tape derived from the run with that id
- /comparisons: a comparison table in the gate report shape (rows as in §5.4): comparisonTable when set, else one row per fork in the store

Errors are JSON too: {""error"": ""...""} with status 404, 405 or 500.
"
Class {
	#name : 'TdServer',
	#superclass : 'Object',
	#instVars : [
		'store',
		'port',
		'server',
		'comparisonTable'
	],
	#category : 'TapeDeck-Server',
	#package : 'TapeDeck-Server'
}

{ #category : 'accessing' }
TdServer class >> defaultPort [

	^ 4778
]

{ #category : 'instance creation' }
TdServer class >> on: aStore [

	^ self new
		  store: aStore;
		  yourself
]

{ #category : 'instance creation' }
TdServer class >> startOn: aStore [

	^ (self on: aStore) start
]

{ #category : 'instance creation' }
TdServer class >> startOn: aStore port: anInteger [

	^ (self on: aStore)
		  port: anInteger;
		  start
]

{ #category : 'accessing' }
TdServer >> bindingAddress [
	"The loopback interface: I never listen on other interfaces."

	^ #[ 127 0 0 1 ]
]

{ #category : 'routes' }
TdServer >> comparisons [

	^ (comparisonTable ifNil: [ TdComparisonTable forStore: store ]) asDictionary
]

{ #category : 'accessing' }
TdServer >> comparisonTable [

	^ comparisonTable
]

{ #category : 'accessing' }
TdServer >> comparisonTable: aComparisonTableOrNil [
	"The table served on /comparisons; nil serves one row per fork in the store."

	comparisonTable := aComparisonTableOrNil
]

{ #category : 'private' }
TdServer >> errorBody: aString [

	^ OrderedDictionary new
		  at: 'error' put: aString;
		  yourself
]

{ #category : 'serving' }
TdServer >> handleRequest: aRequest [
	"ZnServer delegate: answer a ZnResponse."

	^ [ self responseFor: aRequest ]
		  on: Error
		  do: [ :exception | self json: (self errorBody: exception messageText asString) status: 500 ]
]

{ #category : 'routes' }
TdServer >> health [

	^ OrderedDictionary new
		  at: 'ok' put: true;
		  at: 'runs' put: store size;
		  yourself
]

{ #category : 'initialization' }
TdServer >> initialize [

	super initialize.
	port := self class defaultPort
]

{ #category : 'testing' }
TdServer >> isRunning [

	^ server notNil and: [ server isRunning ]
]

{ #category : 'private' }
TdServer >> json: aValue status: anInteger [

	| response |
	response := ZnResponse statusCode: anInteger.
	response headers at: 'Access-Control-Allow-Origin' put: '*'.
	response entity: (ZnEntity with: (TdJson toString: aValue) type: ZnMimeType applicationJson).
	^ response
]

{ #category : 'private' }
TdServer >> notFound: aString [

	^ self json: (self errorBody: aString) status: 404
]

{ #category : 'accessing' }
TdServer >> port [
	"The port I listen on (the one the system chose when I was started on port 0)."

	^ server
		  ifNil: [ port ]
		  ifNotNil: [ server port ]
]

{ #category : 'accessing' }
TdServer >> port: anInteger [
	"0 lets the system choose a free port."

	port := anInteger
]

{ #category : 'printing' }
TdServer >> printOn: aStream [

	aStream
		nextPutAll: 'TdServer(';
		nextPutAll: self url;
		nextPutAll: (self isRunning
				 ifTrue: [ ' running' ]
				 ifFalse: [ ' stopped' ]);
		nextPut: $)
]

{ #category : 'private' }
TdServer >> responseFor: aRequest [

	| segments |
	aRequest method = #GET ifFalse: [
		^ self json: (self errorBody: 'only GET is supported') status: 405 ].
	segments := (aRequest uri pathSegments select: [ :each | each isString and: [ each notEmpty ] ]) asArray.
	^ self route: segments
]

{ #category : 'private' }
TdServer >> route: someSegments [

	someSegments = #( 'health' ) ifTrue: [ ^ self json: self health status: 200 ].
	someSegments = #( 'runs' ) ifTrue: [ ^ self json: self runs status: 200 ].
	someSegments = #( 'comparisons' ) ifTrue: [ ^ self json: self comparisons status: 200 ].
	(someSegments size = 3 and: [ someSegments first = 'runs' and: [ someSegments last = 'timeline' ] ])
		ifTrue: [ ^ self timelineResponseFor: someSegments second ].
	(someSegments size = 2 and: [ someSegments first = 'tapes' ]) ifTrue: [
		^ self tapeResponseFor: someSegments second ].
	^ self notFound: 'no such route'
]

{ #category : 'routes' }
TdServer >> runs [

	^ (store runs collect: [ :each | self summaryOf: each ]) asArray
]

{ #category : 'private' }
TdServer >> ensurePortIsFree [
	"Zinc binds its socket in a background process, where a port conflict cannot be handled: try the port here first."

	| socket |
	port = 0 ifTrue: [ ^ self ].
	socket := Socket newTCP.
	[ socket listenOn: port backlogSize: 1 interface: self bindingAddress ]
		on: Error
		do: [ :exception |
			socket destroy.
			^ self error: 'TdServer cannot listen on port ' , port printString , ': ' , exception messageText asString ].
	socket closeAndDestroy
]

{ #category : 'serving' }
TdServer >> start [
	"Listen on 127.0.0.1 at my port (restarting if I was running). Signals an error if the port is taken."

	self stop.
	self ensurePortIsFree.
	server := (ZnServer on: port)
		          bindingAddress: self bindingAddress;
		          delegate: self;
		          yourself.
	server start.
	server isRunning ifFalse: [
		server := nil.
		self error: 'TdServer could not listen on port ' , port printString ].
	^ self
]

{ #category : 'serving' }
TdServer >> stop [

	server ifNotNil: [
		server stop.
		server := nil ]
]

{ #category : 'accessing' }
TdServer >> store [

	^ store
]

{ #category : 'accessing' }
TdServer >> store: aStore [

	store := aStore
]

{ #category : 'private' }
TdServer >> summaryOf: aRun [

	^ OrderedDictionary new
		  at: 'id' put: aRun id;
		  at: 'task' put: aRun task;
		  at: 'variant' put: aRun variant;
		  at: 'kind' put: aRun kind;
		  at: 'pass' put: aRun pass;
		  at: 'steps' put: aRun stepCount;
		  at: 'tokens' put: aRun tokens;
		  at: 'cost' put: aRun usage roundedCost;
		  yourself
]

{ #category : 'private' }
TdServer >> tapeResponseFor: anId [

	^ (store tapeNamed: anId)
		  ifNil: [ self notFound: 'no tape ' , anId ]
		  ifNotNil: [ :aTape | self json: aTape asDictionary status: 200 ]
]

{ #category : 'routes' }
TdServer >> timelineOf: aRun [

	^ (aRun steps collect: [ :step |
		   OrderedDictionary new
			   at: 'step' put: step index;
			   at: 'live' put: step isLive;
			   at: 'tools' put: (step tools collect: [ :each | self toolSummaryOf: each ]) asArray;
			   at: 'tokens' put: step tokens;
			   at: 'cost' put: step usage roundedCost;
			   yourself ]) asArray
]

{ #category : 'private' }
TdServer >> timelineResponseFor: anId [

	^ (store runWithId: anId)
		  ifNil: [ self notFound: 'no run ' , anId ]
		  ifNotNil: [ :aRun | self json: (self timelineOf: aRun) status: 200 ]
]

{ #category : 'private' }
TdServer >> toolSummaryOf: aToolCall [

	^ OrderedDictionary new
		  at: 'name' put: aToolCall name;
		  at: 'summary' put: aToolCall summary;
		  at: 'exec' put: aToolCall exec;
		  at: 'isError' put: aToolCall isError;
		  yourself
]

{ #category : 'accessing' }
TdServer >> url [

	^ 'http://127.0.0.1:' , self port printString
]
