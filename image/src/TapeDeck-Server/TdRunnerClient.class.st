"
I talk to the TapeDeck runner over its HTTP API (INTERFACES.md §5.5, default http://127.0.0.1:4777). Runs come back as imported TdRun objects with their sessions, gate reports as TdComparisonTable, variants as TdVariant. When I have a store, every run I import is added to it.

	client := TdRunnerClient new baseUrl: 'http://127.0.0.1:4777'.
	client health.
	fork := client forkRun: baseline variant: 'rule-taskrunner' at: 4 lenient: #( 'system' ).
	fork := client forkRun: baseline variant: 'rule-taskrunner' auto: true.
	client replayRun: baseline variant: 'guard-secrets' tape: anEditedTape.
	client gateBaseline: 'vanilla' candidate: 'rule-taskrunner'.
	TdRunnerClient default: client.	""used by aRun forkAt: aStep with: aVariant""

Runs, forks, replays and gates are synchronous and can take minutes with a real model; timeout is in seconds (default 600).
"
Class {
	#name : 'TdRunnerClient',
	#superclass : 'Object',
	#instVars : [
		'baseUrl',
		'timeout',
		'store'
	],
	#classInstVars : [
		'default'
	],
	#category : 'TapeDeck-Server',
	#package : 'TapeDeck-Server'
}

{ #category : 'accessing' }
TdRunnerClient class >> default [
	"The client used by TdRun>>forkAt:with: and friends."

	^ default ifNil: [ default := self new ]
]

{ #category : 'accessing' }
TdRunnerClient class >> default: aClient [

	default := aClient
]

{ #category : 'accessing' }
TdRunnerClient class >> default: aClient during: aBlock [
	"Use aClient as the default while aBlock runs."

	| previous |
	previous := default.
	default := aClient.
	^ aBlock ensure: [ default := previous ]
]

{ #category : 'accessing' }
TdRunnerClient class >> defaultBaseUrl [

	^ Smalltalk os environment
		  at: 'TAPEDECK_RUNNER_URL'
		  ifAbsent: [ 'http://127.0.0.1:4777' ]
]

{ #category : 'accessing' }
TdRunnerClient class >> resetDefault [

	default := nil
]

{ #category : 'private' }
TdRunnerClient >> adopt: aRun [

	store ifNotNil: [ :aStore | aStore addRun: aRun ].
	^ aRun
]

{ #category : 'accessing' }
TdRunnerClient >> baseUrl [

	^ baseUrl
]

{ #category : 'accessing' }
TdRunnerClient >> baseUrl: aString [

	((aString includes: $@) or: [ (aString includes: $?) or: [ aString includes: $# ] ]) ifTrue: [
		TdRunnerError new signal: 'Runner URL must not contain credentials, query parameters or fragments; use TAPEDECK_API_TOKEN instead' ].
	baseUrl := (aString endsWith: '/')
		           ifTrue: [ aString allButLast ]
		           ifFalse: [ aString ]
]

{ #category : 'reports' }
TdRunnerClient >> compareRun: aRunOrId variant: aVariantOrName model: aModelOrNil [

	| body |
	body := self forkBodyFor: aRunOrId variant: aVariantOrName.
	aModelOrNil ifNotNil: [ body at: 'model' put: aModelOrNil ].
	^ self post: #( 'comparisons' ) json: body
]

{ #category : 'runs' }
TdRunnerClient >> forkRun: aRunOrId variant: aVariantOrName model: aModelOrNil [

	^ self forkRun: aRunOrId variant: aVariantOrName at: 1 lenient: nil model: aModelOrNil
]

{ #category : 'runs' }
TdRunnerClient >> forkRun: aRunOrId variant: aVariantOrName at: aStepOrIndex lenient: aCollectionOrNil [
	"Fork a run: replay its tape with the variant, restore the workspace at the step and continue live (POST /api/forks)."

	^ self forkRun: aRunOrId variant: aVariantOrName at: aStepOrIndex lenient: aCollectionOrNil model: nil
]

{ #category : 'runs' }
TdRunnerClient >> forkRun: aRunOrId variant: aVariantOrName at: aStepOrIndex lenient: aCollectionOrNil model: aModelOrNil [

	| body |
	body := self forkBodyFor: aRunOrId variant: aVariantOrName.
	aStepOrIndex ifNotNil: [ body at: 'forkAt' put: (self indexOf: aStepOrIndex) ].
	aCollectionOrNil ifNotNil: [ body at: 'lenient' put: aCollectionOrNil asArray ].
	aModelOrNil ifNotNil: [ body at: 'model' put: aModelOrNil ].
	^ self runFrom: (self post: #( 'forks' ) json: body)
]

{ #category : 'runs' }
TdRunnerClient >> forkRun: aRunOrId variant: aVariantOrName auto: aBoolean [
	"Fork a run where the variant's fork rule says (auto: true)."

	^ self forkRun: aRunOrId variant: aVariantOrName auto: aBoolean model: nil
]

{ #category : 'runs' }
TdRunnerClient >> forkRun: aRunOrId variant: aVariantOrName auto: aBoolean model: aModelOrNil [

	| body |
	body := self forkBodyFor: aRunOrId variant: aVariantOrName.
	body at: 'auto' put: aBoolean.
	aModelOrNil ifNotNil: [ body at: 'model' put: aModelOrNil ].
	^ self runFrom: (self post: #( 'forks' ) json: body)
]

{ #category : 'runs' }
TdRunnerClient >> forkRun: aRunOrId variant: aVariantOrName tape: aTape [
	"Fork from an edited tape: it goes live where the replay first diverges from the tape."

	^ self forkRun: aRunOrId variant: aVariantOrName tape: aTape model: nil
]

{ #category : 'runs' }
TdRunnerClient >> forkRun: aRunOrId variant: aVariantOrName tape: aTape model: aModelOrNil [

	| body |
	body := self forkBodyFor: aRunOrId variant: aVariantOrName.
	body at: 'tape' put: aTape asDictionary.
	aModelOrNil ifNotNil: [ body at: 'model' put: aModelOrNil ].
	^ self runFrom: (self post: #( 'forks' ) json: body)
]

{ #category : 'private' }
TdRunnerClient >> forkBodyFor: aRunOrId variant: aVariantOrName [

	^ OrderedDictionary new
		  at: 'from' put: (self idOf: aRunOrId);
		  at: 'variant' put: (self nameOf: aVariantOrName);
		  yourself
]

{ #category : 'reports' }
TdRunnerClient >> gateBaseline: aBaselineName candidate: aCandidateName [
	"Evaluate a candidate variant against a baseline on the runner (POST /api/gate)."

	^ self tableFrom: (self post: #( 'gate' ) json: (OrderedDictionary new
				    at: 'baseline' put: (self nameOf: aBaselineName);
				    at: 'candidate' put: (self nameOf: aCandidateName);
				    yourself))
]

{ #category : 'private' }
TdRunnerClient >> get: somePathSegments query: aDictionaryOrNil [
	"The response body as text."

	^ self request: [ :client |
		  client
			  url: (self urlFor: somePathSegments query: aDictionaryOrNil);
			  get ]
]

{ #category : 'private' }
TdRunnerClient >> getJson: somePathSegments [

	^ self getJson: somePathSegments query: nil
]

{ #category : 'private' }
TdRunnerClient >> getJson: somePathSegments query: aDictionaryOrNil [

	^ TdJson fromString: (self get: somePathSegments query: aDictionaryOrNil)
]

{ #category : 'runner' }
TdRunnerClient >> health [
	"{ok, version, pi, store}"

	^ self getJson: #( 'health' )
]

{ #category : 'private' }
TdRunnerClient >> idOf: aRunOrId [

	^ aRunOrId isString
		  ifTrue: [ aRunOrId ]
		  ifFalse: [ aRunOrId id ]
]

{ #category : 'runs' }
TdRunnerClient >> importStore [
	"Every run of the runner (with its session) and every gate report, in my store (a new one if I have none)."

	| target |
	target := store ifNil: [ TdStore new ].
	self runs do: [ :each | target addRun: each ].
	self reports do: [ :each | target addReport: (self getJson: { 'reports'. each }) named: each ].
	^ target
]

{ #category : 'private' }
TdRunnerClient >> indexOf: aStepOrIndex [

	^ aStepOrIndex isInteger
		  ifTrue: [ aStepOrIndex ]
		  ifFalse: [ aStepOrIndex index ]
]

{ #category : 'initialization' }
TdRunnerClient >> initialize [

	super initialize.
	self baseUrl: self class defaultBaseUrl.
	timeout := 600
]

{ #category : 'private' }
TdRunnerClient >> nameOf: aVariantOrName [

	^ aVariantOrName isString
		  ifTrue: [ aVariantOrName ]
		  ifFalse: [ aVariantOrName name ]
]

{ #category : 'private' }
TdRunnerClient >> post: somePathSegments json: aDictionary [

	^ TdJson fromString: (self request: [ :client |
			   client
				   url: (self urlFor: somePathSegments query: nil);
				   entity: (ZnEntity with: (TdJson toString: aDictionary) type: ZnMimeType applicationJson);
				   post ])
]

{ #category : 'printing' }
TdRunnerClient >> printOn: aStream [

	aStream
		nextPutAll: 'TdRunnerClient(';
		nextPutAll: baseUrl;
		nextPut: $)
]

{ #category : 'runs' }
TdRunnerClient >> replayRun: aRunOrId variant: aVariantOrName tape: aTapeOrNil [
	"Replay a run's tape (or aTape, e.g. an edited one) with the variant at zero tokens (POST /api/replays)."

	| body |
	body := OrderedDictionary new
		        at: 'from' put: (self idOf: aRunOrId);
		        at: 'variant' put: (self nameOf: aVariantOrName);
		        yourself.
	aTapeOrNil ifNotNil: [ body at: 'tape' put: aTapeOrNil asDictionary ].
	^ self runFrom: (self post: #( 'replays' ) json: body)
]

{ #category : 'reports' }
TdRunnerClient >> reportNamed: aName [
	"A gate report as a TdComparisonTable."

	^ self tableFrom: (self getJson: { 'reports'. aName })
]

{ #category : 'reports' }
TdRunnerClient >> reports [
	"The names of the runner's gate reports."

	^ self getJson: #( 'reports' )
]

{ #category : 'private' }
TdRunnerClient >> request: aBlock [
	"Run one HTTP exchange; answer the response body as text, or signal TdRunnerError."

	| client token |
	client := ZnClient new.
	^ [
	  client timeout: timeout.
	  token := Smalltalk os environment at: 'TAPEDECK_API_TOKEN' ifAbsent: [ nil ].
	  token ifNotNil: [
		  token isEmpty ifFalse: [ client headerAt: 'Authorization' put: 'Bearer ' , token ] ].
	  [ aBlock value: client ]
		  on: NetworkError
		  do: [ :exception |
			  TdRunnerError new signal:
				  'Runner not reachable at ' , baseUrl , ': ' , exception messageText asString ].
	  client isSuccess ifFalse: [ self signalErrorFor: client response ].
	  self textOf: client response ] ensure: [ client close ]
]

{ #category : 'runs' }
TdRunnerClient >> run: aRunOrId [
	"A run with its session and tape report, imported as a TdRun."

	| id |
	id := self idOf: aRunOrId.
	^ self adopt: (TdRun fromDictionary: (self runInfo: id) session: (self sessionOf: id))
]

{ #category : 'private' }
TdRunnerClient >> runFrom: aRunDictionary [
	"The runner answered run.json: import the whole run."

	^ self run: (aRunDictionary at: 'id')
]

{ #category : 'runs' }
TdRunnerClient >> runInfo: aRunOrId [
	"run.json plus the tape report under report."

	^ self getJson: { 'runs'. self idOf: aRunOrId }
]

{ #category : 'runs' }
TdRunnerClient >> runSummaries [
	"run.json of every run, newest first."

	^ self getJson: #( 'runs' )
]

{ #category : 'runs' }
TdRunnerClient >> runSummariesWhere: aDictionary [
	"run.json of the runs matching the filters task, variant and kind."

	^ self getJson: #( 'runs' ) query: aDictionary
]

{ #category : 'runs' }
TdRunnerClient >> runs [
	"Every run of the runner, imported with its session, oldest first."

	^ (self runSummaries collect: [ :each | self run: (each at: 'id') ]) reversed
]

{ #category : 'runs' }
TdRunnerClient >> sessionOf: aRunOrId [
	"The run's session as a TdSessionFile."

	^ TdSessionFile fromString: (self get: { 'runs'. self idOf: aRunOrId. 'session' } query: nil)
]

{ #category : 'private' }
TdRunnerClient >> signalErrorFor: aResponse [

	| message |
	message := [ (TdJson fromString: (self textOf: aResponse)) at: 'error' ifAbsent: [ nil ] ]
		           on: Error
		           do: [ nil ].
	^ TdRunnerError new
		  statusCode: aResponse code;
		  signal: 'Runner answered ' , aResponse code printString , ': '
			  , (message ifNil: [ aResponse statusLine reason asString ]) asString
]

{ #category : 'runs' }
TdRunnerClient >> startRunTask: aTaskId variant: aVariantOrName [
	"Record a full run of a task with a variant (POST /api/runs)."

	^ self startRunTask: aTaskId variant: aVariantOrName model: nil
]

{ #category : 'runs' }
TdRunnerClient >> startRunTask: aTaskId variant: aVariantOrName model: aModelOrNil [

	| body |
	body := OrderedDictionary new
		        at: 'task' put: aTaskId;
		        at: 'variant' put: (self nameOf: aVariantOrName);
		        yourself.
	aModelOrNil ifNotNil: [ body at: 'model' put: aModelOrNil ].
	^ self runFrom: (self post: #( 'runs' ) json: body)
]

{ #category : 'accessing' }
TdRunnerClient >> store [

	^ store
]

{ #category : 'accessing' }
TdRunnerClient >> store: aStoreOrNil [
	"Runs I import are added to this store."

	store := aStoreOrNil
]

{ #category : 'private' }
TdRunnerClient >> tableFrom: aGateReport [

	^ TdComparisonTable fromGateReport: aGateReport in: store
]

{ #category : 'runs' }
TdRunnerClient >> tapeOf: aRunOrId [
	"The run's tape as the runner derives it (INTERFACES.md §4)."

	^ TdTape fromDictionary: (self getJson: { 'runs'. self idOf: aRunOrId. 'tape' })
]

{ #category : 'runner' }
TdRunnerClient >> tasks [
	"[{id, title, split, quirk, prompt}]"

	^ self getJson: #( 'tasks' )
]

{ #category : 'private' }
TdRunnerClient >> textOf: aResponse [

	| contents |
	contents := aResponse contents.
	contents ifNil: [ ^ '' ].
	^ contents isString
		  ifTrue: [ contents ]
		  ifFalse: [ contents utf8Decoded ]
]

{ #category : 'accessing' }
TdRunnerClient >> timeout [

	^ timeout
]

{ #category : 'accessing' }
TdRunnerClient >> timeout: seconds [

	timeout := seconds
]

{ #category : 'private' }
TdRunnerClient >> urlFor: somePathSegments query: aDictionaryOrNil [

	| url |
	url := baseUrl asZnUrl / 'api'.
	somePathSegments do: [ :each | url := url / each asString ].
	aDictionaryOrNil ifNotNil: [
		aDictionaryOrNil keysAndValuesDo: [ :key :value | url queryAt: key put: value asString ] ].
	^ url
]

{ #category : 'runner' }
TdRunnerClient >> variantNamed: aName [

	^ self variants detect: [ :each | each name = aName ] ifNone: [ nil ]
]

{ #category : 'runner' }
TdRunnerClient >> variants [
	"The runner's variants as TdVariant objects."

	^ (self getJson: #( 'variants' )) collect: [ :each | TdVariant fromDictionary: each ]
]
