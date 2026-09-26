"
I am the abstract superclass of the TapeDeck tests. I import the fixture runner store (INTERFACES.md §5.1) and find its runs by what they are rather than by their ids: a failing vanilla baseline of task t01, a fork of it with a candidate variant, the candidate's full rerun, and a replay of the baseline. So the tests keep working when the fixture is regenerated from real runs.

The fixture store is found in this order: the class-side setting (TdTestCase fixturesDirectory: '/abs/store'), the TAPEDECK_FIXTURES environment variable, the default path.
"
Class {
	#name : 'TdTestCase',
	#superclass : 'TestCase',
	#instVars : [
		'store'
	],
	#classVars : [
		'FixturesDirectory'
	],
	#category : 'TapeDeck-Tests',
	#package : 'TapeDeck-Tests'
}

{ #category : 'accessing' }
TdTestCase class >> defaultFixturesDirectory [

	^ '/home/claude/tapedeck/fixtures/store'
]

{ #category : 'accessing' }
TdTestCase class >> fixturesDirectory [
	"The fixture store: the class-side setting, else $TAPEDECK_FIXTURES, else the default."

	^ (FixturesDirectory ifNil: [
		   Smalltalk os environment at: 'TAPEDECK_FIXTURES' ifAbsent: [ self defaultFixturesDirectory ] ])
		  asFileReference
]

{ #category : 'accessing' }
TdTestCase class >> fixturesDirectory: aPathOrNil [
	"Set where the fixture store is; nil goes back to $TAPEDECK_FIXTURES or the default."

	FixturesDirectory := aPathOrNil
]

{ #category : 'testing' }
TdTestCase class >> isAbstract [

	^ self == TdTestCase
]

{ #category : 'fixtures' }
TdTestCase >> baseline [
	"The failing vanilla baseline run."

	^ (self store baselinesFor: 'vanilla') detect: [ :each | each failed ]
]

{ #category : 'fixtures' }
TdTestCase >> branchedSessionText [
	"A small session without tape entries. The assistant entry c is on an abandoned branch; the last entry is a failed response; a later system message removes a section and a tool."

	^ String lf join: #(
		'{"type":"session","version":3,"id":"s-1","timestamp":"2026-09-26T10:00:00.000Z","cwd":"/work"}'
		'{"type":"message","id":"a","parentId":null,"timestamp":"2026-09-26T10:00:01.000Z","message":{"role":"system","content":"","sections":{"preamble":"Be brief.","cwd":"/work"},"toolsAdded":[{"name":"bash","description":"Run a command","parameters":{}}]}}'
		'{"type":"message","id":"b","parentId":"a","timestamp":"2026-09-26T10:00:02.000Z","message":{"role":"user","content":"List the files."}}'
		'{"type":"message","id":"c","parentId":"b","timestamp":"2026-09-26T10:00:03.000Z","message":{"role":"assistant","content":[{"type":"text","text":"First try."}],"provider":"p","model":"m","usage":{"input":10,"output":2,"totalTokens":12,"cost":{"total":0.001}},"stopReason":"stop"}}'
		'{"type":"message","id":"d","parentId":"b","timestamp":"2026-09-26T10:00:04.000Z","message":{"role":"assistant","content":[{"type":"toolCall","id":"call-1","name":"bash","arguments":{"command":"ls /work/src"}}],"provider":"p","model":"m","usage":{"input":11,"output":3,"totalTokens":14,"cost":{"total":0.002}},"stopReason":"toolUse"}}'
		'{"type":"message","id":"e","parentId":"d","timestamp":"2026-09-26T10:00:05.000Z","message":{"role":"toolResult","toolCallId":"call-1","toolName":"bash","content":[{"type":"text","text":"sum.js"}],"isError":false}}'
		'{"type":"message","id":"f","parentId":"e","timestamp":"2026-09-26T10:00:06.000Z","message":{"role":"system","content":"","sections":{"preamble":null,"rules":"Use ls."},"toolsRemoved":[{"name":"bash"}]}}'
		'{"type":"message","id":"g","parentId":"f","timestamp":"2026-09-26T10:00:07.000Z","message":{"role":"assistant","content":[{"type":"text","text":"Done."}],"provider":"p","model":"m","usage":{"input":12,"output":1,"totalTokens":13,"cost":{"total":0.001}},"stopReason":"stop"}}'
		'{"type":"message","id":"h","parentId":"g","timestamp":"2026-09-26T10:00:08.000Z","message":{"role":"assistant","content":[],"provider":"p","model":"m","usage":{"input":0,"output":0,"totalTokens":0,"cost":{"total":0}},"stopReason":"error","errorMessage":"boom"}}' )
]

{ #category : 'fixtures' }
TdTestCase >> fork [
	"The latest fork of the baseline (with the candidate variant)."

	^ (self store forksOf: self baseline) last
]

{ #category : 'fixtures' }
TdTestCase >> gateReport [
	"The gate report comparing the fork's variant with vanilla."

	^ self store reports values detect: [ :each | (each at: 'candidate' ifAbsent: [ nil ]) = self fork variant ]
]

{ #category : 'fixtures' }
TdTestCase >> replay [
	"The zero-token replay of the baseline."

	^ (self store replaysOf: self baseline) first
]

{ #category : 'fixtures' }
TdTestCase >> rerun [
	"The latest full rerun of the task with the fork's variant."

	^ (self store rerunsOf: self fork variant task: self fork task) last
]

{ #category : 'running' }
TdTestCase >> setUp [

	super setUp.
	self
		assert: self class fixturesDirectory exists
		description: 'No fixture store at ' , self class fixturesDirectory fullName
			, ' (set TAPEDECK_FIXTURES or TdTestCase fixturesDirectory:)'
]

{ #category : 'fixtures' }
TdTestCase >> store [
	"A fresh import of the fixture store for each test."

	^ store ifNil: [ store := TdStore fromDirectory: self class fixturesDirectory ]
]
