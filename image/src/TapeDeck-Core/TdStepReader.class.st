"
I turn a session into TdSteps.

With pi-tape entries, each tape.step on the active branch becomes a step: I expand its request delta (the previous request's first keep messages, then append), and attach the response entry and each tool's result message, exec and snapshots.

A session without tape entries still imports: each completed assistant message on the active branch becomes a live step with its tool calls and their results, but no request and no snapshots.

	(TdStepReader on: aSessionFile) steps
"
Class {
	#name : 'TdStepReader',
	#superclass : 'Object',
	#instVars : [
		'session'
	],
	#category : 'TapeDeck-Core',
	#package : 'TapeDeck-Core'
}

{ #category : 'instance creation' }
TdStepReader class >> on: aSessionFile [

	^ self new setSession: aSessionFile
]

{ #category : 'private' }
TdStepReader >> completedResponseIn: anEntry [
	"The assistant message of a message entry, unless it failed (failed responses are not steps)."

	| message |
	(anEntry at: 'type' ifAbsent: [ nil ]) = 'message' ifFalse: [ ^ nil ].
	message := anEntry at: 'message' ifAbsent: [ nil ].
	(message isDictionary and: [ (message at: 'role' ifAbsent: [ nil ]) = 'assistant' ]) ifFalse: [ ^ nil ].
	(#( 'error' 'aborted' 'pending' ) includes: (message at: 'stopReason' ifAbsent: [ nil ])) ifTrue: [ ^ nil ].
	^ TdMessage fromDictionary: message
]

{ #category : 'private' }
TdStepReader >> derivedStepFrom: aMessage entry: anEntry index: anInteger [

	| calls |
	calls := aMessage toolCalls.
	calls do: [ :each | each result: (session toolResultFor: each id) ].
	^ TdStep new
		  index: anInteger;
		  live: true;
		  responseEntryId: (anEntry at: 'id' ifAbsent: [ nil ]);
		  response: aMessage;
		  tools: calls;
		  usage: aMessage usage;
		  yourself
]

{ #category : 'reading' }
TdStepReader >> derivedSteps [
	"One live step per completed assistant message on the active branch."

	| steps |
	steps := OrderedCollection new.
	session activeBranch do: [ :entry |
		(self completedResponseIn: entry) ifNotNil: [ :message |
			steps add: (self derivedStepFrom: message entry: entry index: steps size + 1) ] ].
	^ steps asArray
]

{ #category : 'private' }
TdStepReader >> expand: aDelta after: aPreviousRequest [
	"The full request: the previous request's first keep messages, then the appended ones."

	| keep appended |
	aDelta isDictionary ifFalse: [ ^ #(  ) ].
	keep := ((aDelta at: 'keep' ifAbsent: [ 0 ]) ifNil: [ 0 ]) min: aPreviousRequest size.
	appended := ((aDelta at: 'append' ifAbsent: [ #(  ) ]) ifNil: [ #(  ) ]) collect: [ :each |
		            TdMessage fromDictionary: each ].
	^ (aPreviousRequest first: keep) , appended asArray
]

{ #category : 'private' }
TdStepReader >> messageAt: anEntryId [

	^ (session messageForEntryId: anEntryId) ifNotNil: [ :message | TdMessage fromDictionary: message ]
]

{ #category : 'private' }
TdStepReader >> resultFor: aToolCall [

	aToolCall resultEntryId ifNotNil: [ :entryId |
		(session messageForEntryId: entryId) ifNotNil: [ :message | ^ message ] ].
	^ session toolResultFor: aToolCall id
]

{ #category : 'initialization' }
TdStepReader >> setSession: aSessionFile [

	session := aSessionFile
]

{ #category : 'private' }
TdStepReader >> stepFromTapeData: aDictionary after: aPreviousRequest [

	| delta |
	delta := aDictionary at: 'request' ifAbsent: [ nil ].
	^ TdStep new
		  index: (aDictionary at: 'step' ifAbsent: [ nil ]);
		  live: (aDictionary at: 'live' ifAbsent: [ true ]) == true;
		  requestDelta: delta;
		  request: (self expand: delta after: aPreviousRequest);
		  requestHash: (aDictionary at: 'requestHash' ifAbsent: [ nil ]);
		  responseEntryId: (aDictionary at: 'responseEntryId' ifAbsent: [ nil ]);
		  response: (self messageAt: (aDictionary at: 'responseEntryId' ifAbsent: [ nil ]));
		  tools: ((aDictionary at: 'tools' ifAbsent: [ #(  ) ]) collect: [ :each | self toolCallFromTapeData: each ]);
		  snapshotAfter: (aDictionary at: 'snapshotAfter' ifAbsent: [ nil ]);
		  usage: (TdUsage fromDictionary: (aDictionary at: 'usage' ifAbsent: [ nil ]));
		  yourself
]

{ #category : 'reading' }
TdStepReader >> steps [

	^ session hasTape
		  ifTrue: [ self tapeSteps ]
		  ifFalse: [ self derivedSteps ]
]

{ #category : 'reading' }
TdStepReader >> tapeSteps [
	"One step per tape.step entry, with its request expanded."

	| previous |
	previous := #(  ).
	^ session tapeSteps collect: [ :data |
		  | step |
		  step := self stepFromTapeData: data after: previous.
		  previous := step request.
		  step ]
]

{ #category : 'private' }
TdStepReader >> toolCallFromTapeData: aDictionary [

	| call |
	call := TdToolCall fromTapeDictionary: aDictionary.
	call result: (self resultFor: call).
	^ call
]
