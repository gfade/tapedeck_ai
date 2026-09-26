"
I am one tool call: what the model asked for (id, name, arguments) and, when recorded by pi-tape, how it ran: exec is #real (executed), #stub (the recorded result was played back) or #none (pi answered without executing: blocked by a hook, unknown tool, invalid arguments); then the result message, whether it was an error, and the git snapshot taken after it (INTERFACES.md §2.5).

	aToolCall command.	""for bash""
	aToolCall path.	""for read, edit, write""
	aToolCall isBlocked.
	aToolCall summary.	""'$ npm test'""
	aToolCall resultText.
"
Class {
	#name : 'TdToolCall',
	#superclass : 'Object',
	#instVars : [
		'id',
		'name',
		'args',
		'exec',
		'result',
		'isError',
		'snapshot',
		'resultEntryId',
		'step'
	],
	#category : 'TapeDeck-Core',
	#package : 'TapeDeck-Core'
}

{ #category : 'instance creation' }
TdToolCall class >> fromBlock: aToolCallBlock [
	"A call as the model wrote it in a response content block."

	^ self new
		  id: (aToolCallBlock at: 'id' ifAbsent: [ nil ]);
		  name: (aToolCallBlock at: 'name' ifAbsent: [ nil ]);
		  args: (aToolCallBlock at: 'arguments' ifAbsent: [ nil ]);
		  yourself
]

{ #category : 'instance creation' }
TdToolCall class >> fromTapeDictionary: aDictionary [
	"A call as pi-tape records it in a tape.step entry, or in tape JSON (which adds its result)."

	^ self new
		  id: (aDictionary at: 'id' ifAbsent: [ nil ]);
		  name: (aDictionary at: 'name' ifAbsent: [ nil ]);
		  args: (aDictionary at: 'args' ifAbsent: [ nil ]);
		  exec: ((aDictionary at: 'exec' ifAbsent: [ nil ]) ifNotNil: [ :value | value asSymbol ]);
		  isError: (aDictionary at: 'isError' ifAbsent: [ nil ]);
		  snapshot: (aDictionary at: 'snapshot' ifAbsent: [ nil ]);
		  resultEntryId: (aDictionary at: 'resultEntryId' ifAbsent: [ nil ]);
		  result: (aDictionary at: 'result' ifAbsent: [ nil ]);
		  yourself
]

{ #category : 'accessing' }
TdToolCall >> argumentAt: aName [

	^ self args at: aName ifAbsent: [ nil ]
]

{ #category : 'accessing' }
TdToolCall >> args [
	"The arguments (a dictionary): for a recorded call, the ones it actually ran with."

	^ args ifNil: [ args := OrderedDictionary new ]
]

{ #category : 'accessing' }
TdToolCall >> args: aDictionaryOrNil [

	args := aDictionaryOrNil
]

{ #category : 'converting' }
TdToolCall >> asTapeDictionary [
	"The tools[] entry of tape JSON (INTERFACES.md §4)."

	^ OrderedDictionary new
		  at: 'id' put: id;
		  at: 'name' put: name;
		  at: 'args' put: self args;
		  at: 'exec' put: (exec ifNotNil: [ exec asString ]);
		  at: 'result' put: self resultDictionary;
		  at: 'snapshot' put: snapshot;
		  yourself
]

{ #category : 'accessing' }
TdToolCall >> command [
	"The command of a bash call."

	^ self argumentAt: 'command'
]

{ #category : 'accessing' }
TdToolCall >> exec [
	"#real, #stub, #none, or nil when not recorded by pi-tape."

	^ exec
]

{ #category : 'accessing' }
TdToolCall >> exec: aSymbolOrNil [

	exec := aSymbolOrNil
]

{ #category : 'printing' }
TdToolCall >> execString [

	^ exec
		  ifNil: [ 'unknown' ]
		  ifNotNil: [ exec asString ]
]

{ #category : 'testing' }
TdToolCall >> hasResult [

	^ result notNil
]

{ #category : 'accessing' }
TdToolCall >> id [

	^ id
]

{ #category : 'accessing' }
TdToolCall >> id: aString [

	id := aString
]

{ #category : 'testing' }
TdToolCall >> isBash [

	^ name = 'bash'
]

{ #category : 'testing' }
TdToolCall >> isBlocked [
	"pi answered without executing: blocked by a tool_call hook, unknown tool or invalid arguments."

	^ exec = #none
]

{ #category : 'testing' }
TdToolCall >> isError [

	^ isError ifNil: [ result notNil and: [ (result at: 'isError' ifAbsent: [ false ]) == true ] ]
]

{ #category : 'accessing' }
TdToolCall >> isError: aBooleanOrNil [

	isError := aBooleanOrNil
]

{ #category : 'testing' }
TdToolCall >> isExecuted [

	^ exec = #real
]

{ #category : 'testing' }
TdToolCall >> isStubbed [
	"The recorded result was played back (replay, or a fork before it went live)."

	^ exec = #stub
]

{ #category : 'accessing' }
TdToolCall >> name [

	^ name
]

{ #category : 'accessing' }
TdToolCall >> name: aString [

	name := aString
]

{ #category : 'accessing' }
TdToolCall >> path [
	"The file argument of read, edit, write and similar tools."

	^ (self argumentAt: 'path') ifNil: [ self argumentAt: 'file_path' ]
]

{ #category : 'printing' }
TdToolCall >> printOn: aStream [

	aStream
		nextPutAll: 'TdToolCall(';
		nextPutAll: self summary;
		nextPut: $)
]

{ #category : 'accessing' }
TdToolCall >> result [
	"The tool result message (content, details, isError), or nil."

	^ result
]

{ #category : 'accessing' }
TdToolCall >> result: aDictionaryOrNil [

	result := aDictionaryOrNil
]

{ #category : 'converting' }
TdToolCall >> resultDictionary [
	"The result in tape JSON form: content, details and isError."

	result ifNil: [ ^ nil ].
	^ OrderedDictionary new
		  at: 'content' put: (result at: 'content' ifAbsent: [ #(  ) ]);
		  at: 'details' put: (result at: 'details' ifAbsent: [ nil ]);
		  at: 'isError' put: self isError;
		  yourself
]

{ #category : 'accessing' }
TdToolCall >> resultEntryId [

	^ resultEntryId
]

{ #category : 'accessing' }
TdToolCall >> resultEntryId: aString [

	resultEntryId := aString
]

{ #category : 'accessing' }
TdToolCall >> resultText [
	"The text of the result, or nil when there is none."

	result ifNil: [ ^ nil ].
	^ (TdMessage fromDictionary: result) text
]

{ #category : 'accessing' }
TdToolCall >> run [

	^ step ifNotNil: [ step run ]
]

{ #category : 'accessing' }
TdToolCall >> snapshot [
	"The git snapshot of the workspace after this call, or nil."

	^ snapshot
]

{ #category : 'accessing' }
TdToolCall >> snapshot: aShaOrNil [

	snapshot := aShaOrNil
]

{ #category : 'accessing' }
TdToolCall >> step [

	^ step
]

{ #category : 'accessing' }
TdToolCall >> step: aStep [

	step := aStep
]

{ #category : 'accessing' }
TdToolCall >> stepIndex [

	^ step ifNotNil: [ step index ]
]

{ #category : 'printing' }
TdToolCall >> summary [
	"One line: '$ npm test', 'read src/sum.js', or the name and arguments."

	self isBash ifTrue: [ ^ '$ ' , (TdText oneLine: self command max: 100) ].
	self path ifNotNil: [ :aPath | ^ name asString , ' ' , aPath asString ].
	^ name asString , ' ' , (TdText shorten: (TdJson toString: self args) to: 80)
]

{ #category : 'accessing' }
TdToolCall >> toolCalls [
	"So that a tool call, a step, a run and a store all answer their tool calls."

	^ { self }
]
