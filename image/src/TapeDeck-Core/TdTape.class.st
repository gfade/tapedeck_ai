"
I am a tape in its self-contained JSON form (INTERFACES.md §4, tapedeck.tape/v1): every step's full normalized request, the recorded response, the tool calls with their results and snapshots. I am derived from a run or read from JSON, and I can be edited. An edit of a tool call's arguments changes them both in the response the model gave and in the tool record; an edit of a result replaces the recorded result. Every edit is listed in edits.

	tape := TdTape fromRun: aRun.
	tape editToolCall: 'toy_4_0' command: './tasks test'.
	tape editToolCall: 'toy_4_0' result: '# pass 3' note: 'what if the tests had passed?'.
	tape asJsonString.

The later requests still hold the recorded conversation, so a replay of an edited tape diverges (context) at the step after the edit: that is where a fork goes live with the edit in its context.
"
Class {
	#name : 'TdTape',
	#superclass : 'Object',
	#instVars : [
		'data',
		'run'
	],
	#category : 'TapeDeck-Core',
	#package : 'TapeDeck-Core'
}

{ #category : 'private' }
TdTape class >> dictionaryForRun: aRun [

	^ OrderedDictionary new
		  at: 'format' put: self format;
		  at: 'id' put: aRun id;
		  at: 'sessionId' put: aRun sessionId;
		  at: 'sourceSession' put: aRun sessionPath;
		  at: 'cwd' put: (aRun cwd ifNil: [ '' ]);
		  at: 'upstream' put: aRun upstream;
		  at: 'snapshotBase' put: aRun snapshotBase;
		  at: 'steps' put: (aRun steps collect: [ :each | each asTapeDictionary ]) asArray;
		  at: 'edits' put: #(  );
		  yourself
]

{ #category : 'accessing' }
TdTape class >> format [

	^ 'tapedeck.tape/v1'
]

{ #category : 'instance creation' }
TdTape class >> fromDictionary: aDictionary [

	^ self new setData: (TdJson copy: aDictionary) run: nil
]

{ #category : 'instance creation' }
TdTape class >> fromFile: aFileReferenceOrPath [

	^ self fromDictionary: (TdJson fromFile: aFileReferenceOrPath)
]

{ #category : 'instance creation' }
TdTape class >> fromJsonString: aString [

	^ self fromDictionary: (TdJson fromString: aString)
]

{ #category : 'instance creation' }
TdTape class >> fromRun: aRun [
	"A copy of the run's recording: editing it never changes the run. Only runs recorded with pi-tape have a tape."

	aRun hasTape ifFalse: [ ^ self error: 'Not a tape: ' , aRun id printString , ' was recorded without pi-tape' ].
	^ self new setData: (TdJson copy: (self dictionaryForRun: aRun)) run: aRun
]

{ #category : 'converting' }
TdTape >> asDictionary [

	^ data
]

{ #category : 'converting' }
TdTape >> asJsonString [

	^ TdJson toString: data
]

{ #category : 'converting' }
TdTape >> asJsonStringPretty [

	^ TdJson toStringPretty: data
]

{ #category : 'accessing' }
TdTape >> cwd [

	^ data at: 'cwd' ifAbsent: [ nil ]
]

{ #category : 'editing' }
TdTape >> editToolCall: anId args: aDictionary note: aString [
	"Change the arguments of a recorded tool call, in the response the model gave and in the tool record, and list the edit."

	| step newArgs |
	step := self stepWithToolCall: anId.
	newArgs := TdJson copy: aDictionary.
	(self toolWithId: anId in: step) at: 'args' put: newArgs.
	(self responseBlockWithId: anId in: step) ifNotNil: [ :block |
		block at: 'arguments' put: (TdJson copy: newArgs) ].
	self recordEditOf: step field: 'args' toolId: anId note: aString
]

{ #category : 'editing' }
TdTape >> editToolCall: anId command: aString [
	"Change the command of a recorded bash call."

	^ self editToolCall: anId command: aString note: 'command: ' , aString
]

{ #category : 'editing' }
TdTape >> editToolCall: anId command: aString note: aNote [

	| args |
	args := TdJson copy: ((self toolWithId: anId in: (self stepWithToolCall: anId))
			         at: 'args'
			         ifAbsent: [ OrderedDictionary new ]).
	args at: 'command' put: aString.
	^ self editToolCall: anId args: args note: aNote
]

{ #category : 'editing' }
TdTape >> editToolCall: anId result: aString isError: aBoolean note: aNote [
	"Replace the recorded result of a tool call with one text block."

	| step tool |
	step := self stepWithToolCall: anId.
	tool := self toolWithId: anId in: step.
	tool at: 'result' put: (OrderedDictionary new
			 at: 'content' put: { (OrderedDictionary new
					  at: 'type' put: 'text';
					  at: 'text' put: aString;
					  yourself) };
			 at: 'details' put: ((tool at: 'result' ifAbsent: [ nil ]) ifNotNil: [ :old |
					  old at: 'details' ifAbsent: [ nil ] ]);
			 at: 'isError' put: aBoolean;
			 yourself).
	self recordEditOf: step field: 'result' toolId: anId note: aNote
]

{ #category : 'editing' }
TdTape >> editToolCall: anId result: aString note: aNote [

	^ self editToolCall: anId result: aString isError: false note: aNote
]

{ #category : 'accessing' }
TdTape >> edits [
	"The edits made to this tape: step, toolId, field ('args' or 'result') and note."

	^ (data at: 'edits' ifAbsent: [ nil ]) ifNil: [ #(  ) ]
]

{ #category : 'accessing' }
TdTape >> id [

	^ data at: 'id' ifAbsent: [ nil ]
]

{ #category : 'accessing' }
TdTape >> id: aString [
	"Rename the tape, e.g. before registering an edited copy next to the original."

	data at: 'id' put: aString
]

{ #category : 'testing' }
TdTape >> isEdited [

	^ self edits notEmpty
]

{ #category : 'printing' }
TdTape >> printOn: aStream [

	aStream
		nextPutAll: 'TdTape(';
		nextPutAll: self id asString;
		nextPutAll: ', ';
		print: self stepCount;
		nextPutAll: ' steps, ';
		print: self edits size;
		nextPutAll: ' edits)'
]

{ #category : 'private' }
TdTape >> recordEditOf: aStep field: aField toolId: anId note: aNote [

	data at: 'edits' put: (self edits asArray copyWith: (OrderedDictionary new
				  at: 'step' put: (aStep at: 'step' ifAbsent: [ nil ]);
				  at: 'toolId' put: anId;
				  at: 'field' put: aField;
				  at: 'note' put: aNote;
				  yourself))
]

{ #category : 'private' }
TdTape >> responseBlockWithId: anId in: aStep [

	| response |
	response := aStep at: 'response' ifAbsent: [ nil ].
	response isDictionary ifFalse: [ ^ nil ].
	^ ((response at: 'content' ifAbsent: [ #(  ) ]) ifNil: [ #(  ) ])
		  detect: [ :block |
			  block isDictionary and: [
				  (block at: 'type' ifAbsent: [ nil ]) = 'toolCall' and: [ (block at: 'id' ifAbsent: [ nil ]) = anId ] ] ]
		  ifNone: [ nil ]
]

{ #category : 'accessing' }
TdTape >> run [
	"The run I was derived from, or nil."

	^ run
]

{ #category : 'initialization' }
TdTape >> setData: aDictionary run: aRunOrNil [

	data := aDictionary.
	run := aRunOrNil
]

{ #category : 'accessing' }
TdTape >> stepAt: anInteger [
	"The step dictionary, or nil."

	^ self steps detect: [ :each | (each at: 'step' ifAbsent: [ nil ]) = anInteger ] ifNone: [ nil ]
]

{ #category : 'accessing' }
TdTape >> stepCount [

	^ self steps size
]

{ #category : 'private' }
TdTape >> stepWithToolCall: anId [

	^ self steps
		  detect: [ :step | (self toolWithId: anId in: step) notNil ]
		  ifNone: [ self error: 'No tool call ' , anId printString , ' on tape ' , self id printString ]
]

{ #category : 'accessing' }
TdTape >> steps [
	"The step dictionaries."

	^ (data at: 'steps' ifAbsent: [ nil ]) ifNil: [ #(  ) ]
]

{ #category : 'accessing' }
TdTape >> toolCallAt: anId [
	"The tool dictionary (id, name, args, exec, result, snapshot), or nil."

	self steps do: [ :step | (self toolWithId: anId in: step) ifNotNil: [ :tool | ^ tool ] ].
	^ nil
]

{ #category : 'private' }
TdTape >> toolWithId: anId in: aStep [

	^ ((aStep at: 'tools' ifAbsent: [ #(  ) ]) ifNil: [ #(  ) ])
		  detect: [ :tool | tool isDictionary and: [ (tool at: 'id' ifAbsent: [ nil ]) = anId ] ]
		  ifNone: [ nil ]
]

{ #category : 'writing' }
TdTape >> writeToFile: aFileReferenceOrPath [

	| file |
	file := aFileReferenceOrPath asFileReference.
	file ensureDelete.
	file writeStreamDo: [ :stream | stream nextPutAll: self asJsonStringPretty ].
	^ file
]
