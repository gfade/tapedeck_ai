"
I am one message of a model request or a response: a role and content blocks, in pi-tape's normalized form (INTERFACES.md §2.4) or as recorded in the session. System messages also carry prompt sections (patched by name), toolsAdded, toolsRemoved and replace; TdHarnessState replays them. I read both the normalized forms (sections as [name, value] pairs, toolsRemoved as names) and the session forms (sections as an object, toolsRemoved as {name} objects).

	aStep response text.
	aStep response toolCalls.
	(aStep request detect: [ :each | each isSystem ]) sectionNames.
"
Class {
	#name : 'TdMessage',
	#superclass : 'Object',
	#instVars : [
		'data'
	],
	#category : 'TapeDeck-Core',
	#package : 'TapeDeck-Core'
}

{ #category : 'instance creation' }
TdMessage class >> fromDictionary: aDictionary [

	^ self new setData: aDictionary
]

{ #category : 'converting' }
TdMessage >> asDictionary [

	^ data
]

{ #category : 'accessing' }
TdMessage >> field: aKey [
	"A raw field of the message, or nil."

	^ data at: aKey ifAbsent: [ nil ]
]

{ #category : 'accessing' }
TdMessage >> blocks [
	"The content blocks; a string content is one text block."

	| content |
	content := self field: 'content'.
	content ifNil: [ ^ #(  ) ].
	content isString ifTrue: [
		^ { (OrderedDictionary new
			   at: 'type' put: 'text';
			   at: 'text' put: content;
			   yourself) } ].
	^ content asArray select: [ :each | each isDictionary ]
]

{ #category : 'accessing' }
TdMessage >> blocksOfType: aString [

	^ self blocks select: [ :each | (each at: 'type' ifAbsent: [ nil ]) = aString ]
]

{ #category : 'printing' }
TdMessage >> displayText [
	"The message as readable text: text, thinking, tool calls or result; for a system message, its sections and tool changes."

	^ String streamContents: [ :out | self printBodyOn: out ]
]

{ #category : 'testing' }
TdMessage >> isAssistant [

	^ self role = 'assistant'
]

{ #category : 'testing' }
TdMessage >> isError [
	"For a tool result."

	^ (self field: 'isError') == true
]

{ #category : 'testing' }
TdMessage >> isReplace [
	"A system message that discards the earlier harness state."

	^ (self field: 'replace') == true
]

{ #category : 'testing' }
TdMessage >> isSystem [

	^ self role = 'system'
]

{ #category : 'testing' }
TdMessage >> isToolResult [

	^ self role = 'toolResult'
]

{ #category : 'testing' }
TdMessage >> isUser [

	^ self role = 'user'
]

{ #category : 'private' }
TdMessage >> joinedLines: aCollection [

	^ String lf join: aCollection
]

{ #category : 'accessing' }
TdMessage >> model [

	^ self field: 'model'
]

{ #category : 'private' }
TdMessage >> printBlock: aBlock on: aStream [

	| type |
	type := aBlock at: 'type' ifAbsent: [ nil ].
	type = 'text' ifTrue: [
		^ aStream
			  nextPutAll: (aBlock at: 'text' ifAbsent: [ '' ]) asString;
			  lf ].
	type = 'thinking' ifTrue: [
		^ aStream
			  nextPutAll: '(thinking) ';
			  nextPutAll: (aBlock at: 'thinking' ifAbsent: [ '' ]) asString;
			  lf ].
	type = 'toolCall' ifTrue: [
		^ aStream
			  nextPutAll: '-> ';
			  nextPutAll: (TdToolCall fromBlock: aBlock) summary;
			  lf ].
	type = 'image' ifTrue: [
		^ aStream
			  nextPutAll: '(image)';
			  lf ].
	aStream
		nextPutAll: (TdJson toString: aBlock);
		lf
]

{ #category : 'printing' }
TdMessage >> printBodyOn: aStream [

	self isSystem ifTrue: [ ^ self printSystemOn: aStream ].
	self isToolResult ifTrue: [
		aStream
			nextPutAll: 'result of ';
			nextPutAll: self toolName asString;
			nextPutAll: (self isError
					 ifTrue: [ ' (error)' ]
					 ifFalse: [ '' ]);
			lf ].
	self blocks do: [ :each | self printBlock: each on: aStream ]
]

{ #category : 'printing' }
TdMessage >> printOn: aStream [

	aStream
		nextPutAll: 'TdMessage(';
		nextPutAll: self role asString;
		nextPutAll: ': ';
		nextPutAll: (TdText shorten: self summary to: 60);
		nextPut: $)
]

{ #category : 'printing' }
TdMessage >> printSystemOn: aStream [

	self text ifNotEmpty: [ :text |
		aStream
			nextPutAll: text;
			lf ].
	self isReplace ifTrue: [
		aStream
			nextPutAll: '(replaces the harness)';
			lf ].
	self sectionPairs do: [ :pair |
		aStream nextPutAll: '## ' , pair key asString.
		pair value
			ifNil: [
				aStream
					nextPutAll: ' (removed)';
					lf ]
			ifNotNil: [ :text |
				aStream
					lf;
					nextPutAll: text asString;
					lf ] ].
	self toolsAdded ifNotEmpty: [ :tools |
		aStream
			nextPutAll: '+ tools: ';
			nextPutAll: (', ' join: (tools collect: [ :each | (each at: 'name' ifAbsent: [ '?' ]) asString ]));
			lf ].
	self toolsRemovedNames ifNotEmpty: [ :names |
		aStream
			nextPutAll: '- tools: ';
			nextPutAll: (', ' join: (names collect: [ :each | each asString ]));
			lf ]
]

{ #category : 'accessing' }
TdMessage >> provider [

	^ self field: 'provider'
]

{ #category : 'accessing' }
TdMessage >> role [

	^ self field: 'role'
]

{ #category : 'accessing' }
TdMessage >> sectionNames [

	^ self sectionPairs collect: [ :each | each key ]
]

{ #category : 'accessing' }
TdMessage >> sectionPairs [
	"The prompt sections of a system message as name -> text associations, in order. A nil text removes the section."

	| sections |
	sections := self field: 'sections'.
	sections ifNil: [ ^ #(  ) ].
	sections isDictionary ifTrue: [ ^ sections associations asArray ].
	^ (sections select: [ :each | each isCollection and: [ each size = 2 ] ]) collect: [ :each |
		  each first -> each second ]
]

{ #category : 'initialization' }
TdMessage >> setData: aDictionary [

	data := aDictionary
]

{ #category : 'accessing' }
TdMessage >> stopReason [

	^ self field: 'stopReason'
]

{ #category : 'printing' }
TdMessage >> summary [
	"One line: the tool calls, or the start of the text."

	| calls |
	calls := self toolCalls.
	calls ifNotEmpty: [ ^ ', ' join: (calls collect: [ :each | each summary ]) ].
	self isSystem ifTrue: [ ^ 'sections: ' , (', ' join: (self sectionNames collect: [ :each | each asString ])) ].
	^ TdText oneLine: self text max: 80
]

{ #category : 'accessing' }
TdMessage >> text [
	"The text blocks joined by newlines."

	^ self joinedLines: ((self blocksOfType: 'text') collect: [ :each |
			   (each at: 'text' ifAbsent: [ '' ]) asString ])
]

{ #category : 'accessing' }
TdMessage >> thinking [

	^ self joinedLines: ((self blocksOfType: 'thinking') collect: [ :each |
			   (each at: 'thinking' ifAbsent: [ '' ]) asString ])
]

{ #category : 'accessing' }
TdMessage >> toolCallId [
	"For a tool result."

	^ self field: 'toolCallId'
]

{ #category : 'accessing' }
TdMessage >> toolCalls [
	"The tool calls of an assistant message, as TdToolCall objects without results."

	^ (self blocksOfType: 'toolCall') collect: [ :each | TdToolCall fromBlock: each ]
]

{ #category : 'accessing' }
TdMessage >> toolName [
	"For a tool result."

	^ self field: 'toolName'
]

{ #category : 'accessing' }
TdMessage >> toolsAdded [
	"The tool declarations a system message adds (dictionaries with name, description, parameters)."

	^ ((self field: 'toolsAdded') ifNil: [ #(  ) ]) select: [ :each | each isDictionary ]
]

{ #category : 'accessing' }
TdMessage >> toolsRemovedNames [
	"The names of the tools a system message removes."

	^ ((self field: 'toolsRemoved') ifNil: [ #(  ) ]) collect: [ :each |
		  each isDictionary
			  ifTrue: [ each at: 'name' ifAbsent: [ nil ] ]
			  ifFalse: [ each ] ]
]

{ #category : 'accessing' }
TdMessage >> usage [
	"For an assistant message."

	^ TdUsage fromDictionary: (self field: 'usage')
]
