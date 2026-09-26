"
I am one step of a run: one model request and its response (INTERFACES.md §1). I know whether the response was live or replayed from a tape, the full normalized request (pi-tape stores deltas; TdStepReader expands them), the response, the tool calls with their results and snapshots, the usage, and the harness state the model saw.

	aStep request.	""TdMessage objects, oldest first""
	aStep response toolCalls.
	aStep tools first summary.
	aStep harnessState sectionNames.
	aStep snapshotAfter.

Steps imported from a session without tape entries have no request and no snapshots.
"
Class {
	#name : 'TdStep',
	#superclass : 'Object',
	#instVars : [
		'index',
		'live',
		'request',
		'requestDelta',
		'requestHash',
		'response',
		'responseEntryId',
		'tools',
		'snapshotAfter',
		'usage',
		'run',
		'harnessState'
	],
	#category : 'TapeDeck-Core',
	#package : 'TapeDeck-Core'
}

{ #category : 'converting' }
TdStep >> asTapeDictionary [
	"The steps[] entry of tape JSON (INTERFACES.md §4)."

	^ OrderedDictionary new
		  at: 'step' put: index;
		  at: 'live' put: self isLive;
		  at: 'request' put: (self request collect: [ :each | each asDictionary ]) asArray;
		  at: 'requestHash' put: requestHash;
		  at: 'response' put: (response ifNotNil: [ response asDictionary ]);
		  at: 'tools' put: (tools collect: [ :each | each asTapeDictionary ]) asArray;
		  at: 'snapshotAfter' put: snapshotAfter;
		  yourself
]

{ #category : 'accessing' }
TdStep >> cost [

	^ usage cost
]

{ #category : 'printing' }
TdStep >> costString [

	^ usage costString
]

{ #category : 'printing' }
TdStep >> divergenceMarker [
	"'<< forked here (forced)' on the step where the run diverged from its tape, else ''."

	self isDivergencePoint ifFalse: [ ^ '' ].
	^ '<< ' , (run divergence wentLive
		   ifTrue: [ 'went live' ]
		   ifFalse: [ 'diverged' ]) , ' (' , run divergence kind asString , ')'
]

{ #category : 'testing' }
TdStep >> hasRequest [

	^ request notNil and: [ request notEmpty ]
]

{ #category : 'accessing' }
TdStep >> harnessState [
	"The prompt sections and tools the model saw in this request."

	^ harnessState ifNil: [ harnessState := self computeHarnessState ]
]

{ #category : 'private' }
TdStep >> computeHarnessState [

	self hasRequest ifTrue: [ ^ TdHarnessState fromMessages: request ].
	^ run
		  ifNil: [ TdHarnessState new ]
		  ifNotNil: [ run harnessStateBeforeEntry: responseEntryId ]
]

{ #category : 'accessing' }
TdStep >> index [

	^ index
]

{ #category : 'accessing' }
TdStep >> index: anInteger [

	index := anInteger
]

{ #category : 'initialization' }
TdStep >> initialize [

	super initialize.
	live := true.
	tools := #(  ).
	usage := TdUsage zero
]

{ #category : 'testing' }
TdStep >> isDivergencePoint [
	"Whether my run diverged from its tape at this step."

	^ run notNil and: [ run divergence notNil and: [ run divergence step = index ] ]
]

{ #category : 'testing' }
TdStep >> isLive [
	"The response came from the model (not played back from a tape)."

	^ live == true
]

{ #category : 'testing' }
TdStep >> isReplayed [

	^ self isLive not
]

{ #category : 'accessing' }
TdStep >> live: aBoolean [

	live := aBoolean
]

{ #category : 'printing' }
TdStep >> liveString [

	^ self isLive
		  ifTrue: [ 'live' ]
		  ifFalse: [ 'replayed' ]
]

{ #category : 'printing' }
TdStep >> printOn: aStream [

	aStream
		nextPutAll: 'TdStep(';
		nextPutAll: self summary;
		nextPut: $)
]

{ #category : 'accessing' }
TdStep >> request [
	"The full normalized request (TdMessage objects), empty when not recorded."

	^ request ifNil: [ #(  ) ]
]

{ #category : 'accessing' }
TdStep >> request: aCollectionOfMessages [

	request := aCollectionOfMessages
]

{ #category : 'accessing' }
TdStep >> requestDelta [
	"The request as pi-tape stored it: keep the first n messages of the previous request, append these."

	^ requestDelta
]

{ #category : 'accessing' }
TdStep >> requestDelta: aDictionaryOrNil [

	requestDelta := aDictionaryOrNil
]

{ #category : 'accessing' }
TdStep >> requestHash [

	^ requestHash
]

{ #category : 'accessing' }
TdStep >> requestHash: aString [

	requestHash := aString
]

{ #category : 'printing' }
TdStep >> requestText [
	"The request as readable text, one block per message."

	self hasRequest ifFalse: [ ^ '(no recorded request: the session has no tape entries)' ].
	^ String streamContents: [ :out |
		  self request withIndexDo: [ :message :position |
			  out
				  nextPutAll: '[' , (position - 1) printString , '] ' , message role asString;
				  lf.
			  message printBodyOn: out.
			  out lf ] ]
]

{ #category : 'accessing' }
TdStep >> response [
	"The assistant message (TdMessage) as recorded, or nil."

	^ response
]

{ #category : 'accessing' }
TdStep >> response: aMessageOrNil [

	response := aMessageOrNil
]

{ #category : 'accessing' }
TdStep >> responseEntryId [

	^ responseEntryId
]

{ #category : 'accessing' }
TdStep >> responseEntryId: aString [

	responseEntryId := aString
]

{ #category : 'printing' }
TdStep >> responseText [
	"The response and the results of its tool calls, as readable text."

	response ifNil: [ ^ '(no response)' ].
	^ String streamContents: [ :out |
		  response printBodyOn: out.
		  tools do: [ :each |
			  out
				  lf;
				  nextPutAll: '<- ' , each summary , ' [' , each execString , ']';
				  lf;
				  nextPutAll: (each resultText ifNil: [ '(no result)' ]);
				  lf ] ]
]

{ #category : 'accessing' }
TdStep >> run [

	^ run
]

{ #category : 'accessing' }
TdStep >> run: aRun [

	run := aRun
]

{ #category : 'accessing' }
TdStep >> snapshotAfter [
	"The git snapshot of the workspace after the whole step, or nil."

	^ snapshotAfter
]

{ #category : 'accessing' }
TdStep >> snapshotAfter: aShaOrNil [

	snapshotAfter := aShaOrNil
]

{ #category : 'printing' }
TdStep >> summary [

	^ String streamContents: [ :out |
		  out
			  print: index;
			  space;
			  nextPutAll: self liveString.
		  tools
			  ifEmpty: [
				  response ifNotNil: [
					  out
						  nextPutAll: ': ';
						  nextPutAll: (TdText oneLine: response text max: 60) ] ]
			  ifNotEmpty: [
				  out
					  nextPutAll: ': ';
					  nextPutAll: self toolSummary ] ]
]

{ #category : 'accessing' }
TdStep >> tokens [

	^ usage totalTokens
]

{ #category : 'accessing' }
TdStep >> toolCalls [
	"So that a tool call, a step, a run and a store all answer their tool calls."

	^ tools
]

{ #category : 'printing' }
TdStep >> toolSummary [

	^ '; ' join: (tools collect: [ :each | each summary ])
]

{ #category : 'accessing' }
TdStep >> toolWithId: anId [

	^ tools detect: [ :each | each id = anId ] ifNone: [ nil ]
]

{ #category : 'accessing' }
TdStep >> tools [
	"The tool calls of the response, with results and snapshots when recorded."

	^ tools
]

{ #category : 'accessing' }
TdStep >> tools: aCollectionOfToolCalls [

	tools := aCollectionOfToolCalls asArray.
	tools do: [ :each | each step: self ]
]

{ #category : 'accessing' }
TdStep >> usage [
	"The usage of the response as recorded (a replayed response keeps its token counts; its cost is 0)."

	^ usage
]

{ #category : 'accessing' }
TdStep >> usage: aUsage [

	usage := aUsage
]
