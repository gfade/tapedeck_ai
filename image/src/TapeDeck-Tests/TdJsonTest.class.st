"
I test TdJson: reading with key order kept, escapes, numbers, errors; compact, pretty and canonical writing; helpers.
"
Class {
	#name : 'TdJsonTest',
	#superclass : 'TestCase',
	#category : 'TapeDeck-Tests',
	#package : 'TapeDeck-Tests'
}

{ #category : 'tests' }
TdJsonTest >> testCopyIsDeep [

	| original copy |
	original := TdJson fromString: '{"a":{"b":[1,{"c":2}]}}'.
	copy := TdJson copy: original.
	(((copy at: 'a') at: 'b') at: 2) at: 'c' put: 3.
	self assert: ((((original at: 'a') at: 'b') at: 2) at: 'c') equals: 2
]

{ #category : 'tests' }
TdJsonTest >> testLinesFromString [

	| values |
	values := TdJson linesFromString: '{"a":1}' , String lf , String lf , '[2]' , String lf.
	self assert: values size equals: 2.
	self assert: values last equals: #( 2 )
]

{ #category : 'tests' }
TdJsonTest >> testReadsNumbers [

	self assert: (TdJson fromString: '-12') equals: -12.
	self assert: (TdJson fromString: '0.004782') equals: 0.004782.
	self assert: (TdJson fromString: '1e-05') equals: 0.00001.
	self assert: (TdJson fromString: '2.5E+3') equals: 2500.0.
	self assert: (TdJson fromString: '12345678901234567890') equals: 12345678901234567890.
	self assert: (TdJson fromString: '0.1') equals: 0.1
]

{ #category : 'tests' }
TdJsonTest >> testReadsObjectsInKeyOrder [

	| value |
	value := TdJson fromString: '{"b":1,"a":{"z":true,"y":null},"c":[1,2.5,"x"]}'.
	self assert: value keys asArray equals: #( 'b' 'a' 'c' ).
	self assert: (value at: 'a') keys asArray equals: #( 'z' 'y' ).
	self assert: ((value at: 'a') at: 'y') isNil.
	self assert: ((value at: 'a') at: 'z').
	self assert: (value at: 'c') equals: #( 1 2.5 'x' )
]

{ #category : 'tests' }
TdJsonTest >> testReadsStringEscapes [

	| expected |
	expected := String streamContents: [ :out |
		            out
			            nextPutAll: 'a"b\c/d';
			            nextPut: Character lf;
			            nextPut: Character tab;
			            nextPut: (Character value: 233);
			            nextPut: (Character value: 16r1F600) ].
	self assert: (TdJson fromString: '"a\"b\\c\/d\n\té😀"') equals: expected
]

{ #category : 'tests' }
TdJsonTest >> testRejectsMalformedText [

	self should: [ TdJson fromString: '{"a":}' ] raise: TdJsonError.
	self should: [ TdJson fromString: '[1,2' ] raise: TdJsonError.
	self should: [ TdJson fromString: '{} x' ] raise: TdJsonError.
	self should: [ TdJson fromString: '"open' ] raise: TdJsonError
]

{ #category : 'tests' }
TdJsonTest >> testReplaceInNestedValues [

	| value |
	value := TdJson replace: '/w' with: '<cwd>' in: (TdJson fromString: '{"a":["/w/x",{"b":"/w"}],"n":1}').
	self assert: (TdJson toString: value) equals: '{"a":["<cwd>/x",{"b":"<cwd>"}],"n":1}'
]

{ #category : 'tests' }
TdJsonTest >> testRoundTripsControlAndWideCharacters [

	| text |
	text := String withAll: {
			        $a.
			        Character tab.
			        Character cr.
			        (Character value: 1).
			        $".
			        (Character value: 233).
			        (Character value: 16r1F600) }.
	self assert: (TdJson fromString: (TdJson toString: text)) equals: text
]

{ #category : 'tests' }
TdJsonTest >> testWritesCompactPrettyAndCanonical [

	| value |
	value := OrderedDictionary new
		         at: 'b' put: #( 1 true nil );
		         at: 'a' put: 'x"y';
		         yourself.
	self assert: (TdJson toString: value) equals: '{"b":[1,true,null],"a":"x\"y"}'.
	self assert: (TdJson toCanonicalString: value) equals: '{"a":"x\"y","b":[1,true,null]}'.
	self assert: (TdJson toStringPretty: value) lines size equals: 8.
	self assert: (TdJson is: (TdJson fromString: (TdJson toStringPretty: value)) equalTo: value)
]

{ #category : 'tests' }
TdJsonTest >> testWritesNumbers [

	self assert: (TdJson toString: {
				 1.
				 -2.
				 0.5.
				 (1 / 4) }) equals: '[1,-2,0.5,0.25]'.
	self assert: (TdJson toString: { Float nan. Float infinity }) equals: '[null,null]'.
	self should: [ TdJson toString: Object new ] raise: TdJsonError
]
